import { setTimeout as delay } from 'node:timers/promises';
import { boundedRunSucceeded, runBounded, type ProcessRunner } from '$main/process/runner';
import { childrenByParent, powerShellArgs, WINDOWS_POWERSHELL } from './process-tree';
import { linkedWorkstreams, type DockerContainer, type WorkstreamFolder } from './running-docker';
import { withDescendants } from './running-ports';

export const PROCESS_LIST_ARGS = ['-A', '-ww', '-o', 'pid=,ppid=,tty=,args='] as const;

export const WINDOWS_PROCESS_LIST_ARGS = powerShellArgs(
	[
		'[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
		'$all = @{}',
		'Get-CimInstance Win32_Process | ForEach-Object { $all[$_.ProcessId] = $_ }',
		'foreach ($p in $all.Values) {',
		'$up = $all[$p.ParentProcessId]',
		'$ppid = if ($up -and $up.CreationDate -le $p.CreationDate) { $p.ParentProcessId } else { 0 }',
		'$line = if ($p.CommandLine) { $p.CommandLine } else { $p.Name }',
		"'{0} {1} ? {2}' -f $p.ProcessId, $ppid, ($line -replace '[\\r\\n]+', ' ')",
		'}',
	].join('\n'),
);

const CONSOLE_API = [
	"$api = [Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly([Reflection.AssemblyName]::new('Malini'), 'Run').DefineDynamicModule('Malini').DefineType('Console', 'Public, Abstract, Sealed')",
	'function Import-Api([string] $dll, [string] $name, [Type] $returns, [Type[]] $takes = @()) {',
	"$api.DefinePInvokeMethod($name, $dll, 'Public, Static, PinvokeImpl', 'Standard', $returns, $takes, 'Winapi', 'Unicode').SetImplementationFlags('PreserveSig')",
	'}',
	'Import-Api kernel32.dll FreeConsole ([bool])',
	'Import-Api kernel32.dll AttachConsole ([bool]) ([uint32])',
	'Import-Api kernel32.dll GetConsoleWindow ([IntPtr])',
	'Import-Api kernel32.dll SetConsoleCtrlHandler ([bool]) ([IntPtr], [bool])',
	'Import-Api user32.dll IsWindowVisible ([bool]) ([IntPtr])',
	'Import-Api user32.dll GetClassName ([int]) ([IntPtr], [Text.StringBuilder], [int])',
	'$console = $api.CreateType()',
];
const TERMINALS_LINE = /^terminals:(.*)$/mu;
const WINDOWS_PROBE_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 3_000;
const STOP_POLL_MS = 100;
const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u;
const NO_TERMINAL = new Set(['??', '?', '-']);
const PATH_ENDS = new Set(['', '/', '\\', ' ', '"', "'"]);

export interface LeftoverPlace {
	readonly folders: readonly WorkstreamFolder[];
	readonly live: readonly WorkstreamFolder[];
}

export interface ListedProcess {
	readonly pid: number;
	readonly ppid: number;
	readonly terminal: boolean;
	readonly command: string;
}

export function parseProcessList(output: string): ListedProcess[] {
	return output.split(/\r?\n/u).flatMap((line) => {
		const [, pid, ppid, tty, command] = ROW.exec(line) ?? [];
		if (!pid || !ppid || !tty || !command) return [];
		return [
			{
				pid: Number(pid),
				ppid: Number(ppid),
				terminal: !NO_TERMINAL.has(tty),
				command: command.trim(),
			},
		];
	});
}

export function leftoverProcesses(
	listed: readonly ListedProcess[],
	place: LeftoverPlace,
	appPid: number,
	platform: NodeJS.Platform = process.platform,
): number[] {
	const children = childrenByParent(listed);
	const app = withDescendants([appPid], children);
	const parents = new Map(listed.map(({ pid, ppid }) => [pid, ppid]));
	for (let pid = parents.get(appPid); pid !== undefined && pid > 1; pid = parents.get(pid)) {
		if (app.has(pid)) break;
		app.add(pid);
	}
	const roots = listed
		.filter(
			({ pid, terminal, command }) =>
				pid > 1 && !app.has(pid) && !terminal && runsIn(command, place, platform),
		)
		.map(({ pid }) => pid);
	return [...withDescendants(roots, children)].filter((pid) => !app.has(pid));
}

export async function windowsTerminalProcesses(
	runner: ProcessRunner,
	pids: readonly number[],
): Promise<ReadonlySet<number>> {
	if (pids.length === 0) return new Set();
	try {
		const run = await runBounded(runner, WINDOWS_POWERSHELL, terminalProbeArgs(pids), {
			deadline: Date.now() + WINDOWS_PROBE_TIMEOUT_MS,
		});
		const seen = boundedRunSucceeded(run) ? TERMINALS_LINE.exec(run.stdout)?.[1] : undefined;
		if (seen === undefined) return new Set(pids);
		return new Set(seen.split(' ').filter(Boolean).map(Number));
	} catch {
		return new Set(pids);
	}
}

function terminalProbeArgs(pids: readonly number[]): readonly string[] {
	return powerShellArgs(
		[
			"$ErrorActionPreference = 'Stop'",
			...CONSOLE_API,
			'[void]$console::SetConsoleCtrlHandler([IntPtr]::Zero, $true)',
			`$seen = foreach ($id in @(${pids.join(', ')})) {`,
			'[void]$console::FreeConsole()',
			'if (-not $console::AttachConsole($id)) { continue }',
			'$window = $console::GetConsoleWindow()',
			'$class = [Text.StringBuilder]::new(64)',
			'[void]$console::GetClassName($window, $class, $class.Capacity)',
			"if ($class.ToString() -eq 'PseudoConsoleWindow' -or $console::IsWindowVisible($window)) { $id }",
			'}',
			'[void]$console::FreeConsole()',
			'"terminals:$seen"',
		].join('\n'),
	);
}

export function leftoverContainers(
	containers: readonly DockerContainer[],
	place: LeftoverPlace,
): string[] {
	return containers
		.filter(
			(container) =>
				linkedWorkstreams(container, place.folders).length > 0 &&
				linkedWorkstreams(container, place.live).length === 0,
		)
		.map(({ id }) => id);
}

export async function stopProcesses(
	pids: readonly number[],
	isAlive: (pid: number) => boolean,
): Promise<number> {
	const signaled = pids.filter((pid) => signal(pid, 'SIGTERM'));
	const deadline = Date.now() + STOP_GRACE_MS;
	let alive = signaled.filter(isAlive);
	while (alive.length > 0 && Date.now() < deadline) {
		await delay(STOP_POLL_MS);
		alive = alive.filter(isAlive);
	}
	for (const pid of alive) signal(pid, 'SIGKILL');
	return signaled.length;
}

function signal(pid: number, name: NodeJS.Signals): boolean {
	try {
		process.kill(pid, name);
		return true;
	} catch {
		return false;
	}
}

function runsIn(command: string, place: LeftoverPlace, platform: NodeJS.Platform): boolean {
	const text = comparablePath(command, platform);
	const mentioned = ({ path }: WorkstreamFolder): boolean =>
		mentions(text, comparablePath(path, platform));
	return place.folders.some(mentioned) && !place.live.some(mentioned);
}

function comparablePath(text: string, platform: NodeJS.Platform): string {
	return platform === 'win32' ? text.replaceAll('/', '\\').toLowerCase() : text;
}

function mentions(command: string, folder: string): boolean {
	const root = folder.replace(/[\\/]+$/u, '');
	for (let at = command.indexOf(root); at !== -1; at = command.indexOf(root, at + 1)) {
		if (PATH_ENDS.has(command[at + root.length] ?? '')) return true;
	}
	return false;
}
