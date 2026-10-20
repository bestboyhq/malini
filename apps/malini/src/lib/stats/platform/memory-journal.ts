import type { ResourceKindBreakdown } from '$contract/stats';
import type { JournalProcess, PhysicalMemory } from '$main/diagnostics/diagnostics-files';
import { sanitizeDiagnosticText } from '$main/diagnostics/redaction';
import { childrenByParent, type ProcessRow } from './process-tree';
import { commandLabel } from './resource-breakdown';

export const MEMORY_JOURNAL_INTERVAL_MS = 30_000;
export const FOOTPRINT_TABLE_ARGS = ['-l', '1', '-stats', 'pid,mem'] as const;
export const LISTED_OUTSIDE = 5;

const MAX_LAUNCHERS = 16;
const LABEL_CHARS = 160;
const UNIT_BYTES: Readonly<Record<string, number>> = {
	B: 1,
	K: 1_024,
	M: 1_024 ** 2,
	G: 1_024 ** 3,
	T: 1_024 ** 4,
};
const SIZE = /^(\d+(?:\.\d+)?)([BKMGT])[+-]?$/u;
const FOOTPRINT_ROW = /^\s*(\d+)\s+(\S+)\s*$/u;
const PHYSICAL = /^PhysMem: (\S+) used \((\S+) wired, (\S+) compressor\), (\S+) unused/mu;

export interface Footprints {
	readonly byProcess: ReadonlyMap<number, number>;
	readonly physical: PhysicalMemory | null;
}

export function parseFootprints(output: string): Footprints {
	const byProcess = new Map<number, number>();
	for (const line of output.split('\n')) {
		const [, pid, size] = FOOTPRINT_ROW.exec(line) ?? [];
		const bytes = sizeBytes(size);
		if (pid && bytes !== null) byProcess.set(Number(pid), bytes);
	}
	return { byProcess, physical: physicalMemory(output) };
}

export function launchersOf(rows: readonly ProcessRow[], app: number): ProcessRow[] {
	const byPid = new Map(rows.map((row) => [row.pid, row]));
	const launchers: ProcessRow[] = [];
	let launcher = byPid.get(byPid.get(app)?.ppid ?? 0);
	while (launcher && launcher.pid > 1 && launchers.length < MAX_LAUNCHERS) {
		launchers.push(launcher);
		launcher = byPid.get(launcher.ppid);
	}
	return launchers;
}

export function heaviestOutside(
	rows: readonly ProcessRow[],
	app: number,
	launchers: readonly ProcessRow[],
	limit: number,
): ProcessRow[] {
	const excluded = new Set([...subtree(rows, app), ...launchers.map((row) => row.pid)]);
	return rows
		.filter((row) => !excluded.has(row.pid))
		.sort((left, right) => right.memoryBytes - left.memoryBytes)
		.slice(0, limit);
}

export function journalProcess(
	row: ProcessRow,
	commandLines: ReadonlyMap<number, string>,
): JournalProcess {
	return {
		pid: row.pid,
		ppid: row.ppid,
		label: journalLabel(commandLabel(row, commandLines.get(row.pid))),
		memoryBytes: row.memoryBytes,
	};
}

export function redactBreakdown(
	breakdown: readonly ResourceKindBreakdown[],
): ResourceKindBreakdown[] {
	return breakdown.map((kind) => ({
		...kind,
		items: kind.items.map((item) => ({ ...item, label: journalLabel(item.label) })),
	}));
}

function journalLabel(label: string): string {
	return sanitizeDiagnosticText(label, LABEL_CHARS, false, 'process');
}

function subtree(rows: readonly ProcessRow[], root: number): Set<number> {
	const children = childrenByParent(rows);
	const pids = new Set<number>();
	const pending = [root];
	for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
		if (pids.has(pid)) continue;
		pids.add(pid);
		pending.push(...(children.get(pid) ?? []).map((child) => child.pid));
	}
	return pids;
}

function physicalMemory(output: string): PhysicalMemory | null {
	const sizes = (PHYSICAL.exec(output)?.slice(1, 5) ?? [])
		.map(sizeBytes)
		.filter((size) => size !== null);
	const [usedBytes, wiredBytes, compressorBytes, unusedBytes] = sizes;
	if (
		usedBytes === undefined ||
		wiredBytes === undefined ||
		compressorBytes === undefined ||
		unusedBytes === undefined
	) {
		return null;
	}
	return { usedBytes, wiredBytes, compressorBytes, unusedBytes };
}

function sizeBytes(text: string | undefined): number | null {
	const [, amount, unit] = SIZE.exec(text ?? '') ?? [];
	const multiplier = UNIT_BYTES[unit ?? ''];
	return amount && multiplier ? Math.round(Number(amount) * multiplier) : null;
}
