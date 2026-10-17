import { basename } from 'node:path';
import type { ResourceItem, ResourceKind, ResourceKindBreakdown } from '$contract/stats';
import type { ProcessRoots, ProcessRow, ProcessUnit } from './process-tree';

export const LISTED_PER_KIND = 5;

const LABEL_LENGTH = 160;
const CHROMIUM_ROLES: Readonly<Record<string, string>> = {
	renderer: 'Window',
	'gpu-process': 'Graphics',
};

export interface WorkstreamPlace {
	readonly path: string;
	readonly name: string;
}

export interface BreakdownNames {
	readonly roots: ProcessRoots;
	readonly commandLines: ReadonlyMap<number, string>;
	readonly tabTitles: ReadonlyMap<number, string>;
	readonly workingDirectories: ReadonlyMap<number, string>;
	readonly workstreams: readonly WorkstreamPlace[];
}

export function unitsByKind(units: readonly ProcessUnit[]): Map<ResourceKind, ProcessUnit[]> {
	const byKind = new Map<ResourceKind, ProcessUnit[]>();
	for (const unit of [...units].sort((left, right) => right.memoryBytes - left.memoryBytes)) {
		const listed = byKind.get(unit.kind);
		if (listed) listed.push(unit);
		else byKind.set(unit.kind, [unit]);
	}
	return byKind;
}

export function describeBreakdown(
	byKind: ReadonlyMap<ResourceKind, readonly ProcessUnit[]>,
	names: BreakdownNames,
	containers: readonly ResourceItem[],
): ResourceKindBreakdown[] {
	const breakdown = [...byKind].map(([kind, units]) =>
		kindBreakdown(
			kind,
			units.map((unit) => ({
				label: unitLabel(unit, names),
				workstream: agentWorkstream(unit.agent, names),
				memoryBytes: unit.memoryBytes,
			})),
		),
	);
	if (containers.length === 0) return breakdown;
	const heaviestFirst = [...containers].sort((left, right) => right.memoryBytes - left.memoryBytes);
	return [...breakdown, kindBreakdown('docker', heaviestFirst)];
}

export function parseCommandLines(output: string): Map<number, string> {
	const commandLines = new Map<number, string>();
	for (const line of output.split('\n')) {
		const [, pid, commandLine] = /^\s*(\d+) (.+)$/u.exec(line) ?? [];
		if (pid && commandLine) commandLines.set(Number(pid), commandLine.trim());
	}
	return commandLines;
}

export function parseWorkingDirectories(output: string): Map<number, string> {
	const directories = new Map<number, string>();
	let pid: number | null = null;
	for (const line of output.split('\n')) {
		if (line.startsWith('p')) pid = Number(line.slice(1));
		else if (line.startsWith('n') && pid !== null) directories.set(pid, line.slice(1));
	}
	return directories;
}

function kindBreakdown(kind: ResourceKind, items: readonly ResourceItem[]): ResourceKindBreakdown {
	const unlisted = items.slice(LISTED_PER_KIND);
	return {
		kind,
		items: items.slice(0, LISTED_PER_KIND),
		unlisted: unlisted.length,
		unlistedMemoryBytes: unlisted.reduce((sum, item) => sum + item.memoryBytes, 0),
	};
}

function unitLabel(unit: ProcessUnit, names: BreakdownNames): string {
	const { kind, root, heaviest } = unit;
	if (root.pid === names.roots.app) return 'Main process';
	if (root.pid === names.roots.agentHost) return 'Agent bridge';
	if (kind === 'agents') return 'Claude Code';
	if (kind === 'browser') return names.tabTitles.get(root.pid) || 'Browser tab';
	const commandLine = names.commandLines.get(heaviest.pid);
	return (
		(kind === 'malini' ? chromiumRole(commandLine) : null) ?? commandLabel(heaviest, commandLine)
	);
}

function chromiumRole(commandLine: string | undefined): string | null {
	const type = /--type=(\S+)/u.exec(commandLine ?? '')?.[1];
	if (!type) return null;
	const service = /--utility-sub-type=([a-z_]+)\./u.exec(commandLine ?? '')?.[1];
	if (!service) return CHROMIUM_ROLES[type] ?? 'Helper';
	const words = service.replaceAll('_', ' ');
	return `${words.charAt(0).toUpperCase()}${words.slice(1)} service`;
}

function commandLabel(row: ProcessRow, commandLine: string | undefined): string {
	const program = basename(row.command);
	if (!commandLine) return program;
	const rest = commandLine.startsWith(row.command)
		? commandLine.slice(row.command.length)
		: commandLine.replace(/^\S+/u, '');
	return `${program}${rest}`.slice(0, LABEL_LENGTH);
}

function agentWorkstream(agent: number | null, names: BreakdownNames): string | null {
	const directory = agent === null ? undefined : names.workingDirectories.get(agent);
	if (!directory) return null;
	const place = names.workstreams.find(
		({ path }) => directory === path || directory.startsWith(`${path}/`),
	);
	return place?.name ?? null;
}
