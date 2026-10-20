import { childrenByParent, parseProcessTable, PROCESS_TABLE_ARGS } from './process-tree';

export type PortTool = 'lsof' | 'ps';

export type ReadPortTool = (tool: PortTool, args: readonly string[]) => Promise<string>;

export const LISTENING_SOCKETS_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'] as const;

// ponytail: drops the OS dynamic range, so a server pinned at 49152 or above hides too
const DYNAMIC_PORTS_FROM = 49_152;

export async function readPortsByFile(
	read: ReadPortTool,
	outputFiles: readonly string[],
): Promise<Map<string, number[]>> {
	if (outputFiles.length === 0) return new Map();
	const [holders, table, listening] = await Promise.all([
		read('lsof', ['-F', 'pn', '--', ...outputFiles]),
		read('ps', PROCESS_TABLE_ARGS),
		read('lsof', LISTENING_SOCKETS_ARGS),
	]);
	return portsByFile(outputFiles, parseLsofNames(holders), table, parseLsofNames(listening));
}

export function portsByFile(
	outputFiles: readonly string[],
	holders: ReadonlyMap<number, readonly string[]>,
	processTable: string,
	listening: ReadonlyMap<number, readonly string[]>,
): Map<string, number[]> {
	const children = childrenByParent(parseProcessTable(processTable));
	const ports = new Map<string, number[]>();
	for (const file of outputFiles) {
		const roots = [...holders].filter(([, names]) => names.includes(file)).map(([pid]) => pid);
		const found = new Set<number>();
		for (const pid of withDescendants(roots, children)) {
			for (const name of listening.get(pid) ?? []) {
				const port = listeningPort(name);
				if (port !== null && port < DYNAMIC_PORTS_FROM) found.add(port);
			}
		}
		ports.set(
			file,
			[...found].sort((left, right) => left - right),
		);
	}
	return ports;
}

export function parseLsofNames(output: string): Map<number, string[]> {
	const names = new Map<number, string[]>();
	let current: string[] | null = null;
	for (const line of output.split('\n')) {
		if (line.startsWith('p')) {
			const pid = Number(line.slice(1));
			current = Number.isInteger(pid) && pid > 0 ? (names.get(pid) ?? []) : null;
			if (current) names.set(pid, current);
		} else if (line.startsWith('n') && current) {
			current.push(line.slice(1));
		}
	}
	return names;
}

export function listeningPort(name: string): number | null {
	const digits = /:(\d{1,5})$/u.exec(name)?.[1];
	const port = Number(digits);
	return digits !== undefined && port > 0 && port <= 65_535 ? port : null;
}

function withDescendants(
	roots: readonly number[],
	children: ReadonlyMap<number, readonly { readonly pid: number }[]>,
): Set<number> {
	const found = new Set<number>();
	const pending = [...roots];
	for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
		if (found.has(pid)) continue;
		found.add(pid);
		for (const child of children.get(pid) ?? []) pending.push(child.pid);
	}
	return found;
}
