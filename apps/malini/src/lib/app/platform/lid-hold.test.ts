import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { describeError } from '$main/errors';
import { createNodeProcessRunner, runBounded, type BoundedRun } from '$main/process/runner';
import {
	activeScheme,
	administratorScript,
	batteryDrained,
	batteryLow,
	holdInhibitor,
	launchAgentPlist,
	lidActionValues,
	lidMarker,
	lidTools,
	lidWatchdog,
	markedLidAction,
	powerSupplies,
	readLidAction,
	sleepDisabled,
	startLidWatchdog,
	writeLidAction,
	type LidAction,
} from './lid-hold';

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const LOGIND = spawnSync('systemd-inhibit', ['--list', '--no-pager']).status === 0;
const WINDOWS_CI = process.platform === 'win32' && process.env['CI'] === 'true';

function lidQuery({ ac, dc }: Readonly<{ ac: number; dc: number }>): string {
	const index = (value: number): string => `0x${value.toString(16).padStart(8, '0')}`;
	return [
		`Power Scheme GUID: ${BALANCED}  (Balanced)`,
		'  Subgroup GUID: 4f971e89-eebd-4455-a8de-9e59040e7347  (Power buttons and lid)',
		'    Power Setting GUID: 5ca83367-6e45-459f-a27b-476b1d01c936  (Lid close action)',
		'      Possible Setting Index: 000',
		'      Possible Setting Friendly Name: Do nothing',
		'      Possible Setting Index: 001',
		'      Possible Setting Friendly Name: Sleep',
		`    Current AC Power Setting Index: ${index(ac)}`,
		`    Current DC Power Setting Index: ${index(dc)}`,
	].join('\r\n');
}

function fakePowercfg(keeps: boolean) {
	const values = { ac: 1, dc: 1 };
	const calls: string[] = [];
	const run = async (args: readonly string[]): Promise<BoundedRun> => {
		calls.push(args.join(' '));
		const [verb, , , , value] = args;
		if (!keeps && verb === '/setacvalueindex') values.ac = Number(value);
		if (!keeps && verb === '/setdcvalueindex') values.dc = Number(value);
		const stdout =
			verb === '/getactivescheme'
				? `Power Scheme GUID: ${BALANCED}  (Balanced)`
				: verb === '/q'
					? lidQuery(values)
					: '';
		return { exitCode: 0, stdout, stderr: '', program: '`powercfg`' };
	};
	return { run, calls, values };
}

describe('the lid hold', () => {
	it('reads SleepDisabled from pmset -g, absent meaning off', () => {
		expect(sleepDisabled('System-wide power settings:\n SleepDisabled\t\t1\n sleep 1\n')).toBe(
			true,
		);
		expect(sleepDisabled(' SleepDisabled\t\t0\n')).toBe(false);
		expect(sleepDisabled(' SleepDisabled\t\t10\n')).toBe(false);
		expect(sleepDisabled(' sleep                1 (sleep prevented by Electron)\n')).toBe(false);
	});

	it('lets go at 5% only on battery', () => {
		const battery = (source: string, percent: number): string =>
			`Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t${percent}%; discharging; 0:10 remaining present: true\n`;
		expect(batteryLow(battery('Battery Power', 5))).toBe(true);
		expect(batteryLow(battery('Battery Power', 6))).toBe(false);
		expect(batteryLow(battery('AC Power', 2))).toBe(false);
		expect(batteryLow("Now drawing from 'AC Power'\n")).toBe(false);
	});

	it('quotes the root script for AppleScript', () => {
		expect(administratorScript(`printf '%s\\n' "a"`, 'Why')).toBe(
			`do shell script "printf '%s\\\\n' \\"a\\"" with prompt "Why" with administrator privileges`,
		);
	});

	it('takes fake tools only in an unpackaged build', () => {
		const env = { MALINI_LID_TOOLS: '/tmp/tools' };
		expect(lidTools(false, env).sudo).toBe(join('/tmp/tools', 'sudo'));
		expect(lidTools(false, env).powercfg).toBe(join('/tmp/tools', 'powercfg'));
		expect(lidTools(true, env)).toEqual({
			sudo: '/usr/bin/sudo',
			pmset: '/usr/bin/pmset',
			osascript: '/usr/bin/osascript',
			launchctl: '/bin/launchctl',
			agents: join(homedir(), 'Library', 'LaunchAgents'),
			inhibit: 'systemd-inhibit',
			powerSupply: '/sys/class/power_supply',
			powercfg: join('C:\\Windows', 'System32', 'powercfg.exe'),
			powershell: join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
		});
		expect(lidTools(true, { SystemRoot: 'D:\\Windows' }).powercfg).toBe(
			join('D:\\Windows', 'System32', 'powercfg.exe'),
		);
	});

	it('escapes the launch agent arguments for XML', () => {
		expect(launchAgentPlist('a.b', ['/bin/sh', '[ "$0" ] && x <y>'])).toContain(
			'<array><string>/bin/sh</string><string>[ "$0" ] &amp;&amp; x &lt;y&gt;</string></array>',
		);
	});
});

describe('the lid hold on Linux', () => {
	const battery = (capacity: string, status = 'Discharging', scope = '') => ({
		type: 'Battery',
		scope,
		status,
		capacity,
	});
	const mains = { type: 'Mains', scope: '', status: '', capacity: '' };

	it('lets go at 5% only while the system battery drains', () => {
		expect(batteryDrained([battery('5'), mains])).toBe(true);
		expect(batteryDrained([battery('6')])).toBe(false);
		expect(batteryDrained([battery('2', 'Charging')])).toBe(false);
		expect(batteryDrained([battery('3', 'Not charging')])).toBe(false);
		expect(batteryDrained([battery('1', 'Discharging', 'Device')])).toBe(false);
		expect(batteryDrained([battery('0'), battery('10', 'Unknown')])).toBe(true);
		expect(batteryDrained([battery('')])).toBe(false);
		expect(batteryDrained([mains])).toBe(false);
		expect(batteryDrained([])).toBe(false);
	});

	it('reads each power supply the kernel lists', () => {
		const root = mkdtempSync(join(tmpdir(), 'malini-power-'));
		try {
			mkdirSync(join(root, 'BAT0'));
			writeFileSync(join(root, 'BAT0', 'type'), 'Battery\n');
			writeFileSync(join(root, 'BAT0', 'status'), 'Discharging\n');
			writeFileSync(join(root, 'BAT0', 'capacity'), '4\n');
			mkdirSync(join(root, 'AC'));
			writeFileSync(join(root, 'AC', 'type'), 'Mains\n');
			const supplies = powerSupplies(root);
			expect(supplies).toHaveLength(2);
			expect(supplies).toEqual(
				expect.arrayContaining([
					{ type: 'Battery', scope: '', status: 'Discharging', capacity: '4' },
					{ type: 'Mains', scope: '', status: '', capacity: '' },
				]),
			);
			expect(powerSupplies(join(root, 'missing'))).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe.runIf(LOGIND)('the lid hold with systemd-logind', () => {
	const inhibitors = (): string =>
		execFileSync('systemd-inhibit', ['--list', '--no-pager'], {
			encoding: 'utf8',
			env: { ...process.env, COLUMNS: '500' },
		});

	it('holds an inhibitor in its name until it lets go', async () => {
		const held = await holdInhibitor('systemd-inhibit', 'idle');
		try {
			expect(inhibitors()).toContain('Malini');
			expect(inhibitors()).toContain('An agent is working');
		} finally {
			await held.release();
		}
		expect(inhibitors()).not.toContain('An agent is working');
	});

	it('holds the lid switch, or names why logind refused it', async () => {
		const outcome = async (): Promise<string> => {
			try {
				await (await holdInhibitor('systemd-inhibit', 'handle-lid-switch')).release();
				return 'held';
			} catch (error) {
				return describeError(error);
			}
		};
		expect(await outcome()).toMatch(/^held$|^Failed to inhibit: /u);
	});
});

describe('the lid hold on Windows', () => {
	it('finds the active power plan in any language', () => {
		expect(activeScheme(`Power Scheme GUID: ${BALANCED}  (Balanced)`)).toBe(BALANCED);
		expect(
			activeScheme(
				'GUID des Energieschemas: 381B4222-F694-41F0-9685-FF5BB260DF2E  (Ausbalanciert)',
			),
		).toBe(BALANCED);
		expect(activeScheme('Zugriff verweigert.')).toBeNull();
	});

	it('reads the lid close action on mains and on battery', () => {
		expect(lidActionValues(lidQuery({ ac: 0, dc: 3 }))).toEqual({ ac: 0, dc: 3 });
		expect(
			lidActionValues(
				'Index der aktuellen Wechselstromeinstellung: 0x00000001\nIndex der aktuellen Gleichstromeinstellung: 0x00000002',
			),
		).toEqual({ ac: 1, dc: 2 });
		expect(lidActionValues('Current AC Power Setting Index: 0x00000001')).toBeNull();
		expect(lidActionValues('')).toBeNull();
	});

	it('keeps the lid setting it borrowed only in a marker it can trust', () => {
		const own: LidAction = { scheme: BALANCED, ac: 1, dc: 2 };
		expect(markedLidAction(lidMarker(42, own))).toEqual(own);
		expect(markedLidAction(`42\r\n${BALANCED.toUpperCase()}\r\n1\r\n2\r\n`)).toEqual(own);
		expect(markedLidAction(`42\n${BALANCED}' /x\n1\n2\n`)).toBeNull();
		expect(markedLidAction(`42\n${BALANCED}\n-1\n2\n`)).toBeNull();
		expect(markedLidAction(`42\n${BALANCED}\n1\n`)).toBeNull();
		expect(markedLidAction('')).toBeNull();
	});

	it('quotes the paths in the watchdog script for PowerShell', () => {
		const script = lidWatchdog(7, "C:\\Users\\o'brien\\lid-held", 'C:\\Windows\\powercfg.exe');
		expect(script).toContain("Get-Content -LiteralPath 'C:\\Users\\o''brien\\lid-held'");
		expect(script).toContain("& 'C:\\Windows\\powercfg.exe' /setacvalueindex $saved[1]");
		expect(script).toContain("$saved[0] -eq '7'");
	});

	it('writes the lid close action, checks it and applies it to the active plan', async () => {
		const powercfg = fakePowercfg(false);
		await writeLidAction(powercfg.run, { scheme: BALANCED, ac: 0, dc: 0 });
		expect(powercfg.values).toEqual({ ac: 0, dc: 0 });
		expect(powercfg.calls).toContain(`/setactive ${BALANCED}`);

		const kept = fakePowercfg(true);
		await expect(writeLidAction(kept.run, { scheme: BALANCED, ac: 0, dc: 0 })).rejects.toThrow(
			'Windows kept lid close action 1/1',
		);
		expect(kept.calls).not.toContain(`/setactive ${BALANCED}`);
	});
});

describe.runIf(WINDOWS_CI)('the lid hold with the real powercfg', () => {
	const tools = lidTools(true, process.env);
	const runner = createNodeProcessRunner();
	const powercfg = (args: readonly string[]): Promise<BoundedRun> =>
		runBounded(runner, tools.powercfg, args, { deadline: Date.now() + 30_000 });

	it('reads and writes the lid close action of the active power plan', async () => {
		const own = await readLidAction(powercfg);
		try {
			await writeLidAction(powercfg, { ...own, ac: 0, dc: 2 });
			expect(await readLidAction(powercfg)).toEqual({ ...own, ac: 0, dc: 2 });
		} finally {
			await writeLidAction(powercfg, own);
		}
	}, 60_000);

	it('changes it from a standard user token, with no UAC prompt', async () => {
		const own = await readLidAction(powercfg);
		const want = own.ac === 2 ? 1 : 2;
		const dir = mkdtempSync(join(tmpdir(), 'malini-lid-'));
		const result = join(dir, 'result');
		const probe = join(dir, 'probe.cmd');
		writeFileSync(
			probe,
			[
				'@echo off',
				`"${tools.powercfg}" /setacvalueindex ${own.scheme} SUB_BUTTONS LIDACTION ${want} > "${result}.log" 2>&1`,
				`>"${result}.tmp" echo %errorlevel%`,
				'"%SystemRoot%\\System32\\fltmc.exe" > nul 2>&1',
				`>>"${result}.tmp" echo %errorlevel%`,
				`move /y "${result}.tmp" "${result}" > nul`,
				'',
			].join('\r\n'),
		);
		try {
			const runas = spawnSync('runas', ['/trustlevel:0x20000', `cmd.exe /c "${probe}"`], {
				encoding: 'utf8',
			});
			expect(runas.status, `${runas.stdout}${runas.stderr}`).toBe(0);
			await vi.waitFor(() => expect(existsSync(result)).toBe(true), {
				timeout: 30_000,
				interval: 250,
			});
			const [written, admin] = readFileSync(result, 'utf8').split(/\r?\n/u);
			const plan = (await powercfg(['/getsecuritydescriptor', own.scheme])).stdout.trim();
			expect(admin?.trim(), 'the probe ran with an administrator token').not.toBe('0');
			expect(
				written?.trim(),
				`powercfg said "${readFileSync(`${result}.log`, 'utf8').trim()}" under ${plan}`,
			).toBe('0');
			expect((await readLidAction(powercfg)).ac).toBe(want);
		} finally {
			await writeLidAction(powercfg, own);
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);

	it('puts the lid setting back once the Malini that borrowed it is gone', async () => {
		const own = await readLidAction(powercfg);
		const borrowed: LidAction = { ...own, ac: 1, dc: 1 };
		const dir = mkdtempSync(join(tmpdir(), 'malini-lid-'));
		const marker = join(dir, 'lid-held');
		const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
			stdio: 'ignore',
		});
		try {
			const pid = holder.pid;
			if (pid === undefined) throw new Error('node did not start');
			await writeLidAction(powercfg, borrowed);
			writeFileSync(marker, lidMarker(pid, borrowed));
			await writeLidAction(powercfg, { ...borrowed, ac: 0, dc: 0 });
			startLidWatchdog(tools, pid, marker);
			await delay(3_000);
			expect(await readLidAction(powercfg)).toEqual({ ...borrowed, ac: 0, dc: 0 });
			expect(existsSync(marker)).toBe(true);

			holder.kill();
			await vi.waitFor(
				async () => {
					expect(await readLidAction(powercfg)).toEqual(borrowed);
					expect(existsSync(marker)).toBe(false);
				},
				{ timeout: 30_000, interval: 500 },
			);
		} finally {
			holder.kill();
			await writeLidAction(powercfg, own);
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);
});
