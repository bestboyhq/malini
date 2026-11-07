import { spawn, type ChildProcess } from 'node:child_process';
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
const HELD_SETTING = 'app.lid-held';
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
const WATCHDOG_SCRIPT = `read _; exec "$0" -n ${PMSET} -a disablesleep 0`;
const BATTERY_FLOOR_PERCENT = 5;
const CHECK_MS = 60_000;
const TOOL_TIMEOUT_MS = 10_000;
const PROMPT_TIMEOUT_MS = 5 * 60_000;
const RUN_EDGES: ReadonlySet<unknown> = new Set(['run.started', 'run.completed', 'run.failed']);

export interface LidTools {
	readonly sudo: string;
	readonly pmset: string;
	readonly osascript: string;
}

export interface LidHold {
	hold(on: boolean): Promise<boolean>;
	stop(): Promise<void>;
}

export function lidTools(packaged: boolean, env: NodeJS.ProcessEnv): LidTools {
	const local = packaged ? undefined : env['MALINI_LID_TOOLS'];
	if (!local) return { sudo: '/usr/bin/sudo', pmset: PMSET, osascript: '/usr/bin/osascript' };
	return {
		sudo: join(local, 'sudo'),
		pmset: join(local, 'pmset'),
		osascript: join(local, 'osascript'),
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

export function startLidHold(
	{ db, events }: Pick<MainContext, 'db' | 'events'>,
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

	let watchdog: ChildProcess | null = null;
	let stale: boolean | null = null;
	let stopping = false;
	let failing = false;
	let tail: Promise<unknown> = Promise.resolve();

	const acquire = async (): Promise<void> => {
		if (await readSleepDisabled()) return;
		if (!(await setSleepDisabled(true))) throw new Error('sudo refused to turn sleep off');
		setSetting(db, HELD_SETTING, 'yes');
		const guard = spawn('/bin/sh', ['-c', WATCHDOG_SCRIPT, tools.sudo], {
			detached: true,
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		guard.on('error', (error) =>
			console.warn(`malini: lid watchdog failed: ${describeError(error)}`),
		);
		watchdog = guard;
	};
	const release = async (): Promise<void> => {
		if (!(await setSleepDisabled(false))) throw new Error('sudo refused to turn sleep back on');
		watchdog?.kill();
		watchdog = null;
		setSetting(db, HELD_SETTING, 'no');
	};
	const wanted = async (): Promise<boolean> =>
		!stopping &&
		holdsLid(getSetting(db, LID_HOLD_SETTING)) &&
		openAgentRunCount(db) > 0 &&
		!batteryLow((await tool(tools.pmset, ['-g', 'batt'])).stdout);
	const settle = async (): Promise<void> => {
		stale ??= getSetting(db, HELD_SETTING) === 'yes';
		if (stale) {
			await release();
			stale = false;
		}
		const want = await wanted();
		if (want === (watchdog !== null)) return;
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
		if (/User cancel+ed|\(-128\)/u.test(run.stderr)) return false;
		if (!boundedRunSucceeded(run)) throw new Error(boundedRunFailureReason(run, 'osascript'));
		if (!(await granted())) throw new Error('this Mac account is not an administrator');
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
			if (on && !(await serial(async () => (await granted()) || grant()))) return false;
			setSetting(db, LID_HOLD_SETTING, on ? 'on' : 'off');
			await reconcile();
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
