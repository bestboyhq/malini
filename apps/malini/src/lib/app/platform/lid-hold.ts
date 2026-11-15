import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { powerSaveBlocker } from 'electron';
import type { LidHoldState } from '$contract/commands';
import { APP_STARTED_CHANNEL, CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import {
	boundedRunFailureReason,
	boundedRunSucceeded,
	runBounded,
	type BoundedRun,
	type ProcessRunner,
} from '$main/process/runner';
import { osPlatform } from '$shared/os/os.platform';
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
const LID_INHIBITOR = 'handle-lid-switch';
const INHIBITOR_REASON = 'An agent is working';
const HOLD_ONLY = 'echo held; exec cat';
const GUID = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/iu;
const WHOLE_GUID = new RegExp(`^${GUID.source}$`, 'iu');
const DO_NOTHING = 0;

export interface LidTools {
	readonly sudo: string;
	readonly pmset: string;
	readonly osascript: string;
	readonly launchctl: string;
	readonly agents: string;
	readonly inhibit: string;
	readonly powerSupply: string;
	readonly powercfg: string;
	readonly powershell: string;
}

export interface LidHold {
	state(): Promise<LidHoldState>;
	hold(on: boolean): Promise<boolean>;
	stop(): Promise<void>;
}

export type LidAction = Readonly<{ scheme: string; ac: number; dc: number }>;

export type PowerSupply = Readonly<{
	type: string;
	scope: string;
	status: string;
	capacity: string;
}>;

export type HeldInhibitor = Readonly<{ exited: Promise<void>; release: () => Promise<void> }>;

type Tool = (file: string, args: readonly string[], timeoutMs?: number) => Promise<BoundedRun>;

interface LidDriver {
	readonly available: () => Promise<boolean>;
	readonly switchOn: () => Promise<boolean>;
	readonly switchOff: () => Promise<void>;
	readonly acquire: () => Promise<boolean>;
	readonly release: () => Promise<void>;
	readonly leftover: () => boolean;
	readonly batteryLow: () => Promise<boolean>;
}

interface DriverContext {
	readonly tool: Tool;
	readonly tools: LidTools;
	readonly marker: string;
	readonly appDataRoot: string;
	readonly lost: () => void;
}

export function lidTools(packaged: boolean, env: NodeJS.ProcessEnv): LidTools {
	const local = packaged ? undefined : env['MALINI_LID_TOOLS'];
	if (!local) {
		const system = join(env['SystemRoot'] ?? 'C:\\Windows', 'System32');
		return {
			sudo: '/usr/bin/sudo',
			pmset: PMSET,
			osascript: '/usr/bin/osascript',
			launchctl: '/bin/launchctl',
			agents: join(homedir(), 'Library', 'LaunchAgents'),
			inhibit: 'systemd-inhibit',
			powerSupply: '/sys/class/power_supply',
			powercfg: join(system, 'powercfg.exe'),
			powershell: join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
		};
	}
	return {
		sudo: join(local, 'sudo'),
		pmset: join(local, 'pmset'),
		osascript: join(local, 'osascript'),
		launchctl: join(local, 'launchctl'),
		agents: join(local, 'LaunchAgents'),
		inhibit: join(local, 'systemd-inhibit'),
		powerSupply: join(local, 'power_supply'),
		powercfg: join(local, 'powercfg'),
		powershell: join(local, 'powershell'),
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

export function batteryDrained(supplies: readonly PowerSupply[]): boolean {
	const batteries = supplies.filter(({ type, scope }) => type === 'Battery' && scope !== 'Device');
	const levels = batteries
		.filter(({ capacity }) => /^\d+$/u.test(capacity))
		.map(({ capacity }) => Number(capacity));
	return (
		batteries.some(({ status }) => status === 'Discharging') &&
		levels.length > 0 &&
		levels.reduce((sum, level) => sum + level, 0) / levels.length <= BATTERY_FLOOR_PERCENT
	);
}

export function powerSupplies(root: string): PowerSupply[] {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	return names.map((name) => {
		const field = (file: string): string => {
			try {
				return readFileSync(join(root, name, file), 'utf8').trim();
			} catch {
				return '';
			}
		};
		return {
			type: field('type'),
			scope: field('scope'),
			status: field('status'),
			capacity: field('capacity'),
		};
	});
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

export function activeScheme(getActiveScheme: string): string | null {
	return GUID.exec(getActiveScheme)?.[0].toLowerCase() ?? null;
}

export function lidActionValues(query: string): Readonly<{ ac: number; dc: number }> | null {
	const [ac, dc] = [...query.matchAll(/0x([0-9a-f]{8})/giu)]
		.slice(-2)
		.map(([, hex]) => Number.parseInt(hex ?? '', 16));
	return ac === undefined || dc === undefined ? null : { ac, dc };
}

export function lidMarker(pid: number, { scheme, ac, dc }: LidAction): string {
	return `${pid}\n${scheme}\n${ac}\n${dc}\n`;
}

export function markedLidAction(marker: string): LidAction | null {
	const [, scheme = '', ac = '', dc = ''] = marker.split(/\r?\n/u);
	return WHOLE_GUID.test(scheme) && /^\d+$/u.test(ac) && /^\d+$/u.test(dc)
		? { scheme: scheme.toLowerCase(), ac: Number(ac), dc: Number(dc) }
		: null;
}

export function lidWatchdog(pid: number, marker: string, powercfg: string): string {
	const text = (value: string): string => `'${value.replaceAll("'", "''")}'`;
	const run = `& ${text(powercfg)}`;
	return [
		"$ErrorActionPreference = 'SilentlyContinue'",
		`$holder = Get-Process -Id ${pid}`,
		'if ($holder) { $holder.WaitForExit() }',
		`$saved = @(Get-Content -LiteralPath ${text(marker)})`,
		`if ($saved.Count -ge 4 -and $saved[0] -eq '${pid}' -and $saved[1] -match '^[0-9a-fA-F-]{36}$' -and $saved[2] -match '^\\d+$' -and $saved[3] -match '^\\d+$') {`,
		`\t${run} /setacvalueindex $saved[1] SUB_BUTTONS LIDACTION $saved[2]`,
		`\t${run} /setdcvalueindex $saved[1] SUB_BUTTONS LIDACTION $saved[3]`,
		`\tif ((${run} /getactivescheme) -match $saved[1]) { ${run} /setactive $saved[1] }`,
		`\tRemove-Item -LiteralPath ${text(marker)}`,
		'}',
	].join('\n');
}

export async function readLidAction(
	powercfg: (args: readonly string[]) => Promise<BoundedRun>,
	scheme?: string,
): Promise<LidAction> {
	const plan = scheme ?? activeScheme((await powercfg(['/getactivescheme'])).stdout);
	if (plan === null) throw new Error('powercfg names no active power plan');
	const values = lidActionValues((await powercfg(['/q', plan, 'SUB_BUTTONS', 'LIDACTION'])).stdout);
	if (values === null) throw new Error(`power plan ${plan} has no lid close action`);
	return { scheme: plan, ...values };
}

export async function writeLidAction(
	powercfg: (args: readonly string[]) => Promise<BoundedRun>,
	action: LidAction,
): Promise<void> {
	const succeed = async (args: readonly string[]): Promise<void> => {
		const run = await powercfg(args);
		if (!boundedRunSucceeded(run)) throw new Error(boundedRunFailureReason(run, 'powercfg'));
	};
	await succeed(['/setacvalueindex', action.scheme, 'SUB_BUTTONS', 'LIDACTION', String(action.ac)]);
	await succeed(['/setdcvalueindex', action.scheme, 'SUB_BUTTONS', 'LIDACTION', String(action.dc)]);
	const written = await readLidAction(powercfg, action.scheme);
	if (written.ac !== action.ac || written.dc !== action.dc) {
		throw new Error(`Windows kept lid close action ${written.ac}/${written.dc}`);
	}
	if (activeScheme((await powercfg(['/getactivescheme'])).stdout) === action.scheme) {
		await succeed(['/setactive', action.scheme]);
	}
}

export function holdInhibitor(file: string, what: string): Promise<HeldInhibitor> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			file,
			[
				`--what=${what}`,
				'--who=Malini',
				`--why=${INHIBITOR_REASON}`,
				'--mode=block',
				'/bin/sh',
				'-c',
				HOLD_ONLY,
			],
			{ stdio: 'pipe' },
		);
		let stderr = '';
		const exited = new Promise<void>((done) => child.once('exit', () => done()));
		const deadline = setTimeout(() => child.kill('SIGKILL'), TOOL_TIMEOUT_MS);
		child.stdin.on('error', () => undefined);
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.once('error', (error) => {
			clearTimeout(deadline);
			reject(error);
		});
		child.stdout.once('data', () => {
			clearTimeout(deadline);
			resolve({
				exited,
				release: async () => {
					const kill = setTimeout(() => child.kill('SIGKILL'), TOOL_TIMEOUT_MS);
					child.stdin.end();
					await exited;
					clearTimeout(kill);
				},
			});
		});
		child.once('exit', () => {
			clearTimeout(deadline);
			reject(new Error(stderr.trim() || `${file} exited before it held ${what}`));
		});
	});
}

export function startLidWatchdog(
	tools: Pick<LidTools, 'powershell' | 'powercfg'>,
	pid: number,
	marker: string,
): ChildProcess {
	const script = Buffer.from(lidWatchdog(pid, marker, tools.powercfg), 'utf16le');
	const watchdog = spawn(
		tools.powershell,
		['-NoProfile', '-NonInteractive', '-EncodedCommand', script.toString('base64')],
		{ detached: true, windowsHide: true, stdio: 'ignore' },
	);
	watchdog.unref();
	return watchdog;
}

function blockIdleSleep(): () => void {
	const id = powerSaveBlocker.start('prevent-app-suspension');
	return () => {
		powerSaveBlocker.stop(id);
	};
}

function macLid({ tool, tools, marker, appDataRoot }: DriverContext): LidDriver {
	const setSleepDisabled = async (value: boolean): Promise<boolean> =>
		boundedRunSucceeded(
			await tool(tools.sudo, ['-n', PMSET, '-a', 'disablesleep', value ? '1' : '0']),
		);
	const readSleepDisabled = async (): Promise<boolean> =>
		sleepDisabled((await tool(tools.pmset, ['-g'])).stdout);

	const label = `app.malini.desktop.lid.${createHash('sha256').update(appDataRoot).digest('hex').slice(0, 12)}`;
	const agentFile = join(tools.agents, `${label}.plist`);
	const agentPlist = launchAgentPlist(label, ['/bin/sh', '-c', AGENT_SCRIPT, marker, tools.sudo]);
	const domain = `gui/${userInfo().uid}`;

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

	return {
		available: async () => true,
		switchOn: async () => {
			if (!(await granted()) && !(await grant())) return false;
			await installAgent();
			return true;
		},
		switchOff: async () => {
			await tool(tools.launchctl, ['bootout', `${domain}/${label}`]);
			rmSync(agentFile, { force: true });
		},
		acquire: async () => {
			if (await readSleepDisabled()) return false;
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
			return true;
		},
		release: async () => {
			if (!(await setSleepDisabled(false))) throw new Error('sudo refused to turn sleep back on');
			rmSync(marker, { force: true });
		},
		leftover: () => existsSync(marker),
		batteryLow: async () => batteryLow((await tool(tools.pmset, ['-g', 'batt'])).stdout),
	};
}

function linuxLid({ tool, tools, lost }: DriverContext): LidDriver {
	let logind: Promise<boolean> | undefined;
	let held: HeldInhibitor | null = null;
	let unblock: (() => void) | null = null;
	const listed = async (): Promise<boolean> => {
		try {
			return boundedRunSucceeded(await tool(tools.inhibit, ['--list', '--no-pager']));
		} catch {
			return false;
		}
	};
	const available = (): Promise<boolean> => (logind ??= listed());

	return {
		available,
		switchOn: async () => {
			if (!(await available())) throw new Error('systemd-logind is not running');
			await (await holdInhibitor(tools.inhibit, LID_INHIBITOR)).release();
			return true;
		},
		switchOff: async () => undefined,
		acquire: async () => {
			const inhibitor = await holdInhibitor(tools.inhibit, LID_INHIBITOR);
			held = inhibitor;
			unblock = blockIdleSleep();
			void (async () => {
				await inhibitor.exited;
				if (held !== inhibitor) return;
				held = null;
				unblock?.();
				unblock = null;
				lost();
			})();
			return true;
		},
		release: async () => {
			const inhibitor = held;
			held = null;
			unblock?.();
			unblock = null;
			await inhibitor?.release();
		},
		leftover: () => false,
		batteryLow: async () => batteryDrained(powerSupplies(tools.powerSupply)),
	};
}

function windowsLid({ tool, tools, marker }: DriverContext): LidDriver {
	const powercfg = (args: readonly string[]): Promise<BoundedRun> => tool(tools.powercfg, args);
	let watching = false;
	let unblock: (() => void) | null = null;
	const watch = (): void => {
		if (watching) return;
		watching = true;
		startLidWatchdog(tools, process.pid, marker).once('error', (error) => {
			watching = false;
			console.warn(`malini: could not start the lid watchdog: ${describeError(error)}`);
		});
	};

	return {
		available: async () => true,
		switchOn: async () => {
			await writeLidAction(powercfg, await readLidAction(powercfg));
			return true;
		},
		switchOff: async () => undefined,
		acquire: async () => {
			const own = await readLidAction(powercfg);
			if (own.ac !== DO_NOTHING || own.dc !== DO_NOTHING) {
				watch();
				writeFileSync(`${marker}.tmp`, lidMarker(process.pid, own));
				renameSync(`${marker}.tmp`, marker);
				try {
					await writeLidAction(powercfg, { ...own, ac: DO_NOTHING, dc: DO_NOTHING });
				} catch (error) {
					await writeLidAction(powercfg, own).catch(() => undefined);
					rmSync(marker, { force: true });
					throw error;
				}
			}
			unblock = blockIdleSleep();
			return true;
		},
		release: async () => {
			const saved = existsSync(marker) ? markedLidAction(readFileSync(marker, 'utf8')) : null;
			if (saved) await writeLidAction(powercfg, saved);
			rmSync(marker, { force: true });
			unblock?.();
			unblock = null;
		},
		leftover: () => existsSync(marker),
		batteryLow: async () => false,
	};
}

const DRIVERS = { darwin: macLid, linux: linuxLid, win32: windowsLid } as const;

export function startLidHold(
	{ db, events, appDataRoot }: Pick<MainContext, 'db' | 'events' | 'appDataRoot'>,
	runner: ProcessRunner,
	tools: LidTools,
	platform: string = process.platform,
): LidHold {
	const tool: Tool = (file, args, timeoutMs = TOOL_TIMEOUT_MS) =>
		runBounded(runner, file, args, { deadline: Date.now() + timeoutMs });

	let held = false;
	let stopping = false;
	let failing = false;
	let tail: Promise<unknown> = Promise.resolve();

	const driver = DRIVERS[osPlatform(platform)]({
		tool,
		tools,
		appDataRoot,
		marker: join(appDataRoot, 'lid-held'),
		lost: () => {
			held = false;
		},
	});
	const release = async (): Promise<void> => {
		await driver.release();
		held = false;
	};
	const wanted = async (): Promise<boolean> =>
		!stopping &&
		holdsLid(getSetting(db, LID_HOLD_SETTING)) &&
		openAgentRunCount(db) > 0 &&
		(await driver.available()) &&
		!(await driver.batteryLow());
	const settle = async (): Promise<void> => {
		if (!held && driver.leftover()) await release();
		const want = await wanted();
		if (want === held) return;
		if (want) held = await driver.acquire();
		else await release();
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

	const unsubscribers = [
		events.subscribe(APP_STARTED_CHANNEL, () => void reconcile()),
		events.subscribe(CHAT_AGENT_EVENT_CHANNEL, ({ ephemeral, event }) => {
			if (!ephemeral && RUN_EDGES.has(event.type)) void reconcile();
		}),
	];
	const timer = setInterval(() => void reconcile(), CHECK_MS);
	timer.unref();

	return {
		state: async () => {
			const available = await driver.available();
			return { on: available && holdsLid(getSetting(db, LID_HOLD_SETTING)), available };
		},
		hold: async (on) => {
			if (on && !(await serial(driver.switchOn))) return false;
			setSetting(db, LID_HOLD_SETTING, on ? 'on' : 'off');
			await reconcile();
			if (!on) {
				await serial(async () => {
					if (!held) await driver.switchOff();
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
