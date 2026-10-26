import type { ResourceKind, ResourceUsage } from '$contract/stats';

export const PROCESS_TABLE_ARGS = ['-A', '-o', 'pid=,ppid=,rss=,%cpu=,comm='] as const;

export interface ProcessRow {
	readonly pid: number;
	readonly ppid: number;
	readonly memoryBytes: number;
	readonly cpuPercent: number;
	readonly command: string;
}

export interface ProcessRoots {
	readonly app: number;
	readonly browserTabs: ReadonlySet<number>;
	readonly agentHost: number | null;
}

export interface ProcessUnit {
	readonly kind: ResourceKind;
	readonly root: ProcessRow;
	readonly heaviest: ProcessRow;
	readonly agent: number | null;
	readonly memoryBytes: number;
}

export interface ProcessTreeUsage {
	readonly processes: number;
	readonly usage: readonly ResourceUsage[];
	readonly units: readonly ProcessUnit[];
}

type OpenUnit = { -readonly [Key in keyof ProcessUnit]: ProcessUnit[Key] };

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/u;
const KIND_ORDER: readonly ResourceKind[] = ['malini', 'browser', 'agents', 'tools'];

export function parseProcessTable(output: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of output.split('\n')) {
		const [, pid, ppid, rssKilobytes, cpu, command] = ROW.exec(line) ?? [];
		if (!pid || !ppid || !rssKilobytes || !cpu || !command) continue;
		rows.push({
			pid: Number(pid),
			ppid: Number(ppid),
			memoryBytes: Number(rssKilobytes) * 1_024,
			cpuPercent: Number(cpu),
			command: command.trim(),
		});
	}
	return rows;
}

export function measureProcessTree(
	rows: readonly ProcessRow[],
	roots: ProcessRoots,
	cores: number,
): ProcessTreeUsage {
	const app = rows.find((row) => row.pid === roots.app);
	if (!app) return { processes: 0, usage: [], units: [] };
	const children = childrenByParent(rows);
	const totals = new Map<ResourceKind, ResourceUsage>();
	const units: OpenUnit[] = [];
	const visited = new Set<number>();
	const visit = (
		row: ProcessRow,
		kind: ResourceKind,
		opened: OpenUnit | null,
		agent: number | null,
	): void => {
		if (visited.has(row.pid)) return;
		visited.add(row.pid);
		const total = totals.get(kind) ?? { kind, memoryBytes: 0, cpuPercent: 0, processes: 0 };
		totals.set(kind, {
			kind,
			memoryBytes: total.memoryBytes + row.memoryBytes,
			cpuPercent: total.cpuPercent + row.cpuPercent / Math.max(1, cores),
			processes: total.processes + 1,
		});
		const unit =
			opened ?? openUnit(units, { kind, root: row, heaviest: row, agent, memoryBytes: 0 });
		unit.memoryBytes += row.memoryBytes;
		if (row.memoryBytes > unit.heaviest.memoryBytes) unit.heaviest = row;
		for (const child of children.get(row.pid) ?? []) {
			if (isOwnSampler(child, roots)) continue;
			const nextKind = childKind(child, row, kind, roots);
			const splits = nextKind !== kind || row.pid === roots.app || row.pid === roots.agentHost;
			visit(child, nextKind, splits ? null : unit, row.pid === roots.agentHost ? child.pid : agent);
		}
	};
	visit(app, 'malini', null, null);
	return {
		processes: visited.size,
		usage: KIND_ORDER.flatMap((kind) => totals.get(kind) ?? []),
		units,
	};
}

function openUnit(units: OpenUnit[], unit: OpenUnit): OpenUnit {
	units.push(unit);
	return unit;
}

export function childrenByParent<Row extends { readonly ppid: number }>(
	rows: readonly Row[],
): Map<number, Row[]> {
	const children = new Map<number, Row[]>();
	for (const row of rows) {
		const siblings = children.get(row.ppid);
		if (siblings) siblings.push(row);
		else children.set(row.ppid, [row]);
	}
	return children;
}

function childKind(
	child: ProcessRow,
	parent: ProcessRow,
	parentKind: ResourceKind,
	roots: ProcessRoots,
): ResourceKind {
	if (roots.browserTabs.has(child.pid)) return 'browser';
	if (child.pid === roots.agentHost || parent.pid === roots.agentHost) return 'agents';
	if (parentKind === 'agents') return 'tools';
	return parentKind;
}

function isOwnSampler(row: ProcessRow, roots: ProcessRoots): boolean {
	return row.ppid === roots.app && /^\(?(?:.*\/)?(?:ps|top|lsof)\)?$/u.test(row.command);
}
