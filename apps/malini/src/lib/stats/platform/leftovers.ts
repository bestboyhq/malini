import { sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { childrenByParent } from './process-tree';
import { containerWorkstream, type DockerContainer, type WorkstreamFolder } from './running-docker';
import { withDescendants } from './running-ports';

export const PROCESS_LIST_ARGS = ['-A', '-ww', '-o', 'pid=,ppid=,tty=,args='] as const;

const STOP_GRACE_MS = 3_000;
const STOP_POLL_MS = 100;
const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u;
const NO_TERMINAL = new Set(['??', '?', '-']);
const PATH_ENDS = new Set(['', sep, ' ', '"', "'"]);

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
	return output.split('\n').flatMap((line) => {
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
				pid > 1 && !app.has(pid) && !terminal && runsIn(command, place),
		)
		.map(({ pid }) => pid);
	return [...withDescendants(roots, children)].filter((pid) => !app.has(pid));
}

export function leftoverContainers(
	containers: readonly DockerContainer[],
	place: LeftoverPlace,
): string[] {
	return containers
		.filter(
			(container) =>
				containerWorkstream(container, place.folders) !== null &&
				containerWorkstream(container, place.live) === null,
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

function runsIn(command: string, place: LeftoverPlace): boolean {
	return (
		place.folders.some(({ path }) => mentions(command, path)) &&
		!place.live.some(({ path }) => mentions(command, path))
	);
}

function mentions(command: string, folder: string): boolean {
	const root = folder.endsWith(sep) ? folder.slice(0, -sep.length) : folder;
	for (let at = command.indexOf(root); at !== -1; at = command.indexOf(root, at + 1)) {
		if (PATH_ENDS.has(command[at + root.length] ?? '')) return true;
	}
	return false;
}
