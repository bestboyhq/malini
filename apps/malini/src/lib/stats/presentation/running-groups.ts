import type { RunningItem } from '$contract/stats';

export type RunningGroup = Readonly<{ label: string; items: readonly RunningItem[] }>;

export function runningGroups(items: readonly RunningItem[]): readonly RunningGroup[] {
	const groups = new Map<string, RunningItem[]>();
	for (const item of [...items].sort(agentFirst)) {
		const label = groupLabel(item);
		const group = groups.get(label);
		if (group) group.push(item);
		else groups.set(label, [item]);
	}
	return [...groups].map(([label, grouped]) => ({ label, items: grouped }));
}

function agentFirst(left: RunningItem, right: RunningItem): number {
	return Number(left.origin === 'docker') - Number(right.origin === 'docker');
}

function groupLabel(item: RunningItem): string {
	if (item.origin === 'agent') return 'Started by the agent';
	return item.group ? `Docker · ${item.group}` : 'Docker';
}

export function fittingCount(widths: readonly number[], room: number, moreWidth: number): number {
	if (widths.reduce((total, width) => total + width, 0) <= room) return widths.length;
	let used = moreWidth;
	let count = 0;
	for (const width of widths) {
		used += width;
		if (used > room) break;
		count += 1;
	}
	return count;
}
