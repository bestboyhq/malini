import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { APP_STARTED_CHANNEL, CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import {
	boundedRunFailureReason,
	boundedRunSucceeded,
	runBounded,
	type ProcessRunner,
} from '$main/process/runner';
import { holdsLid, LID_HOLD_SETTING } from '../domain/lid-hold';
import { openAgentRunCount } from './graceful-shutdown';
import { getSetting, setSetting } from './settings.repository';

const PMSET = '/usr/bin/pmset';
const GRANT_FILE = '/etc/sudoers.d/malini';
const GRANT_RULE = `%admin ALL=(root) NOPASSWD: ${PMSET} -a disablesleep 1, ${PMSET} -a disablesleep 0`;
const GRANT_SCRIPT = [
	'umask 022',
	`t=${GRANT_FILE}.tmp`,
	`printf '%s\\n' '# Installed by Malini, after Close My Lid' '${GRANT_RULE}' > "$t"`,
	'/usr/sbin/chown root:wheel "$t"',
	'/bin/chmod 444 "$t"',
	`/usr/sbin/visudo -cf "$t" > /dev/null && /bin/mv "$t" ${GRANT_FILE} || { /bin/rm -f "$t"; exit 1; }`,
].join('; ');
const GRANT_PROMPT = 'Malini needs this once to keep your Mac awake with the lid closed.';
const PROCESS_STARTED = 'LC_ALL=C TZ=UTC0 /bin/ps -o lstart= -p "$pid"';
const AGENT_SCRIPT = [
	'[ -f "$0" ] || exit 0',
	'pid=$(/usr/bin/head -n 1 "$0")',
	`[ -n "$pid" ] && [ "$(${PROCESS_STARTED})" = "$(/usr/bin/tail -n +2 "$0")" ] && exit 0`,
	`"$1" -n ${PMSET} -a disablesleep 0 && /bin/rm -f "$0"`,
].join('\n');
const AGENT_INTERVAL_SECONDS = 30;
const BATTERY_FLOOR_PERCENT = 5;
const CHECK_MS = 60_000;
const TOOL_TIMEOUT_MS = 10_000;
const PROMPT_TIMEOUT_MS = 5 * 60_000;
const RUN_EDGES: ReadonlySet<unknown> = new Set(['run.started', 'run.completed', 'run.failed']);

export interface LidTools {
	readonly sudo: string;
	readonly pmset: string;
	readonly osascript: string;
	readonly launchctl: string;
	readonly agents: string;
}

export interface LidHold {
	hold(on: boolean): Promise<boolean>;
	stop(): Promise<void>;
}

export function lidTools(packaged: boolean, env: NodeJS.ProcessEnv): LidTools {
	const local = packaged ? undefined : env['MALINI_LID_TOOLS'];
	if (!local) {
		return {
			sudo: '/usr/bin/sudo',
			pmset: PMSET,
			osascript: '/usr/bin/osascript',
			launchctl: '/bin/launchctl',
			agents: join(homedir(), 'Library', 'LaunchAgents'),
		};
	}
	return {
		sudo: join(local, 'sudo'),
		pmset: join(local, 'pmset'),
		osascript: join(local, 'osascript'),
		launchctl: join(local, 'launchctl'),
		agents: join(local, 'LaunchAgents'),
	};
}

export function sleepDisabled(pmsetSettings: string): boolean {
	return /^\s*(?:SleepDisabled|disablesleep)\s+1\s*$/imu.test(pmsetSettings);
}

export function batteryLow(pmsetBattery: string): boolean {
	const percent = /(\d+)%/u.exec(pmsetBattery)?.[1];
	return (
		pmsetBattery.includes("'Battery Power'") &&
		percent !== undefined &&
		Number(percent) <= BATTERY_FLOOR_PERCENT
	);
}

export function administratorScript(shellScript: string, prompt: string): string {
	const quoted = (text: string): string =>
		`"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
	return `do shell script ${quoted(shellScript)} with prompt ${quoted(prompt)} with administrator privileges`;
}

export function launchAgentPlist(label: string, programArguments: readonly string[]): string {
	const string = (text: string): string =>
		`<string>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</string>`;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		'<dict>',
		`<key>Label</key>${string(label)}`,
		`<key>ProgramArguments</key><array>${programArguments.map(string).join('')}</array>`,
		`<key>StartInterval</key><integer>${AGENT_INTERVAL_SECONDS}</integer>`,
		'<key>RunAtLoad</key><true/>',
		`<key>ProcessType</key>${string('Background')}`,
		`<key>AssociatedBundleIdentifiers</key><array>${string('app.malini.desktop')}</array>`,
		'</dict>',
		'</plist>',
		'',
	].join('\n');
}

export function startLidHold(
	{ db, events, appDataRoot }: Pick<MainContext, 'db' | 'events' | 'appDataRoot'>,
	runner: ProcessRunner,
	tools: LidTools,
): LidHold {
	const tool = (file: string, args: readonly string[], timeoutMs = TOOL_TIMEOUT_MS) =>
		runBounded(runner, file, args, { deadline: Date.now() + timeoutMs });
	const setSleepDisabled = async (value: boolean): Promise<boolean> =>
		boundedRunSucceeded(
			await tool(tools.sudo, ['-n', PMSET, '-a', 'disablesleep', value ? '1' : '0']),
		);
	const readSleepDisabled = async (): Promise<boolean> =>
		sleepDisabled((await tool(tools.pmset, ['-g'])).stdout);

	const marker = join(appDataRoot, 'lid-held');
	const label = `app.malini.desktop.lid.${createHash('sha256').update(appDataRoot).digest('hex').slice(0, 12)}`;
	const agentFile = join(tools.agents, `${label}.plist`);
	const agentPlist = launchAgentPlist(label, ['/bin/sh', '-c', AGENT_SCRIPT, marker, tools.sudo]);
	const domain = `gui/${userInfo().uid}`;

	let held = false;
	let stopping = false;
	let failing = false;
	let tail: Promise<unknown> = Promise.resolve();

	const installAgent = async (): Promise<void> => {
		const current = existsSync(agentFile) ? readFileSync(agentFile, 'utf8') : '';
		if (
			current === agentPlist &&
			boundedRunSucceeded(await tool(tools.launchctl, ['print', `${domain}/${label}`]))
		) {
			return;
		}
		mkdirSync(tools.agents, { recursive: true });
		writeFileSync(agentFile, agentPlist);
		await tool(tools.launchctl, ['bootout', `${domain}/${label}`]);
		const run = await tool(tools.launchctl, ['bootstrap', domain, agentFile]);
		if (!boundedRunSucceeded(run)) throw new Error(boundedRunFailureReason(run, 'launchctl'));
	};
	const removeAgent = async (): Promise<void> => {
		await tool(tools.launchctl, ['bootout', `${domain}/${label}`]);
		rmSync(agentFile, { force: true });
	};
	const acquire = async (): Promise<void> => {
		if (await readSleepDisabled()) return;
		await installAgent();
		const started = await tool('/bin/sh', [
			'-c',
			`pid=$0; ${PROCESS_STARTED}`,
			String(process.pid),
		]);
		if (!boundedRunSucceeded(started)) throw new Error(boundedRunFailureReason(started, 'ps'));
		writeFileSync(`${marker}.tmp`, `${process.pid}\n${started.stdout}`);
		renameSync(`${marker}.tmp`, marker);
		if (!(await setSleepDisabled(true))) {
			rmSync(marker, { force: true });
			throw new Error('sudo refused to turn sleep off');
		}
		held = true;
	};
	const release = async (): Promise<void> => {
		if (!(await setSleepDisabled(false))) throw new Error('sudo refused to turn sleep back on');
		rmSync(marker, { force: true });
		held = false;
	};
	const wanted = async (): Promise<boolean> =>
		!stopping &&
		holdsLid(getSetting(db, LID_HOLD_SETTING)) &&
		openAgentRunCount(db) > 0 &&
		!batteryLow((await tool(tools.pmset, ['-g', 'batt'])).stdout);
	const settle = async (): Promise<void> => {
		if (!held && existsSync(marker)) await release();
		const want = await wanted();
		if (want === held) return;
		await (want ? acquire() : release());
	};
	const serial = <T>(step: () => Promise<T>): Promise<T> => {
		const previous = tail;
		const current = (async () => {
			await previous;
			return step();
		})();
		tail = current.catch(() => undefined);
		return current;
	};
	const reconcile = async (): Promise<void> => {
		try {
			await serial(settle);
			failing = false;
		} catch (error) {
			if (!failing) console.warn(`malini: could not hold the lid: ${describeError(error)}`);
			failing = true;
		}
	};

	const granted = async (): Promise<boolean> => setSleepDisabled(await readSleepDisabled());
	const grant = async (): Promise<boolean> => {
		const run = await tool(
			tools.osascript,
			['-e', administratorScript(GRANT_SCRIPT, GRANT_PROMPT)],
			PROMPT_TIMEOUT_MS,
		);
		if (run.exitCode === null || /User cancel+ed|\(-128\)/u.test(run.stderr)) return false;
		if (!boundedRunSucceeded(run)) throw new Error(boundedRunFailureReason(run, 'osascript'));
		if (!(await granted())) throw new Error('this Mac account is not an administrator');
		return true;
	};
	const switchOn = async (): Promise<boolean> => {
		if (!(await granted()) && !(await grant())) return false;
		await installAgent();
		return true;
	};

	const unsubscribers = [
		events.subscribe(APP_STARTED_CHANNEL, () => void reconcile()),
		events.subscribe(CHAT_AGENT_EVENT_CHANNEL, ({ ephemeral, event }) => {
			if (!ephemeral && RUN_EDGES.has(event.type)) void reconcile();
		}),
	];
	const timer = setInterval(() => void reconcile(), CHECK_MS);
	timer.unref();

	return {
		hold: async (on) => {
			if (on && !(await serial(switchOn))) return false;
			setSetting(db, LID_HOLD_SETTING, on ? 'on' : 'off');
			await reconcile();
			if (!on) {
				await serial(async () => {
					if (!held) await removeAgent();
				});
			}
			return on;
		},
		stop: () => {
			stopping = true;
			clearInterval(timer);
			for (const unsubscribe of unsubscribers) unsubscribe();
			return reconcile();
		},
	};
}
