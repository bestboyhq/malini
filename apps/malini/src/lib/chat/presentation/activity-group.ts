import { canonicalChangedPath, type RunTimelineItem } from './run-timeline';
import {
	toolActionKind,
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
	toolFailureReason,
	type ToolActionKind,
} from './tool-display-name';

export type ActivityFailure = {
	key: string;
	label: string;
	message: string;
};

export type ActivityGroup = {
	kind: 'activity-group';
	key: string;
	items: readonly RunTimelineItem[];
	verb: string;
	detail: string;
	status: 'running' | 'completed' | 'failed';
	actionKinds: readonly ToolActionKind[];
	failures: readonly ActivityFailure[];
};

export type GroupedRunTimelineItem = RunTimelineItem | ActivityGroup;

export const ACTIVITY_GROUP_MIN_ITEMS = 2;

export const ACTIVITY_GROUP_DETAIL_MAX_CHARS = 64;

type MachineActivityItem = Extract<
	RunTimelineItem,
	{ kind: 'tool' | 'command' | 'file' | 'thought' }
>;

type ItemStatus = 'running' | 'completed' | 'failed';

type ActivityVerbStem = 'explore' | 'edit' | 'run' | 'think' | 'work';

const VERB_FORMS: Readonly<Record<ActivityVerbStem, { past: string; present: string }>> = {
	explore: { past: 'Explored', present: 'Exploring' },
	edit: { past: 'Edited', present: 'Editing' },
	run: { past: 'Ran', present: 'Running' },
	think: { past: 'Thought', present: 'Thinking' },
	work: { past: 'Worked', present: 'Working' },
};

const TOOL_PATH_KEYS = [
	'file_path',
	'path',
	'filePath',
	'file',
	'filename',
	'notebook_path',
	'notebookPath',
] as const;

export function groupRunTimeline(items: readonly RunTimelineItem[]): GroupedRunTimelineItem[] {
	const grouped: GroupedRunTimelineItem[] = [];
	let pending: MachineActivityItem[] = [];

	function flush(): void {
		if (pending.length >= ACTIVITY_GROUP_MIN_ITEMS) grouped.push(buildActivityGroup(pending));
		else grouped.push(...pending);
		pending = [];
	}

	for (const item of items) {
		if (isMachineActivity(item)) {
			pending.push(item);
			continue;
		}
		flush();
		grouped.push(item);
	}
	flush();

	return grouped;
}

function isMachineActivity(item: RunTimelineItem): item is MachineActivityItem {
	return (
		item.kind === 'tool' ||
		item.kind === 'command' ||
		item.kind === 'file' ||
		item.kind === 'thought'
	);
}

function buildActivityGroup(items: readonly MachineActivityItem[]): ActivityGroup {
	const actions = items.map(itemActionKind);
	const statuses = items.map(itemStatus);
	const actionKinds = distinct(actions);
	const forms = VERB_FORMS[verbStem(actionKinds)];

	return {
		kind: 'activity-group',
		key: `activity-${items[0]?.key ?? 'empty'}`,
		items: [...items],
		verb: statuses.includes('running') ? forms.present : forms.past,
		detail: groupDetail(items, actions),
		status: groupStatus(statuses),
		actionKinds,
		failures: items
			.map(itemFailure)
			.filter((failure): failure is ActivityFailure => failure !== null),
	};
}

function itemActionKind(item: MachineActivityItem): ToolActionKind | null {
	switch (item.kind) {
		case 'tool':
			return toolActionKind(item.tool.name, item.tool.input);
		case 'command':
			return 'command';
		case 'file':
			return 'edit';
		case 'thought':
			return null;
	}
}

function itemStatus(item: MachineActivityItem): ItemStatus {
	if (item.kind === 'tool') return item.tool.status;
	if (item.kind === 'command') {
		if (item.exitCode === null) return 'running';
		return item.error === undefined ? 'completed' : 'failed';
	}
	return 'completed';
}

function itemFailure(item: MachineActivityItem): ActivityFailure | null {
	if (item.kind === 'tool' && item.tool.status === 'failed') {
		return {
			key: item.key,
			label:
				toolDescriptionLabel(item.tool.name, item.tool.input) ??
				toolActivityLabel(item.tool.name, item.tool.input, 'completed'),
			message:
				toolFailureReason(item.tool.error) ??
				`${toolDisplayName(item.tool.name, item.tool.input)} failed`,
		};
	}
	if (item.kind === 'command' && item.error !== undefined) {
		return {
			key: item.key,
			label: item.description ?? item.command,
			message: toolFailureReason(item.error) ?? 'The command could not finish',
		};
	}
	return null;
}

function groupStatus(statuses: readonly ItemStatus[]): ItemStatus {
	if (statuses.includes('failed')) return 'failed';
	if (statuses.includes('running')) return 'running';
	return 'completed';
}

function distinct(actions: readonly (ToolActionKind | null)[]): ToolActionKind[] {
	const kinds: ToolActionKind[] = [];
	for (const action of actions) {
		if (action !== null && !kinds.includes(action)) kinds.push(action);
	}
	return kinds;
}

function verbStem(actionKinds: readonly ToolActionKind[]): ActivityVerbStem {
	if (actionKinds.length === 0) return 'think';
	if (actionKinds.includes('edit')) return 'edit';
	if (actionKinds.every((kind) => kind === 'read' || kind === 'search')) return 'explore';
	if (actionKinds.every((kind) => kind === 'command')) return 'run';
	return 'work';
}

function groupDetail(
	items: readonly MachineActivityItem[],
	actions: readonly (ToolActionKind | null)[],
): string {
	const files = distinctFiles(items, actions);
	let searches = 0;
	let commands = 0;
	for (const [index, item] of items.entries()) {
		if (item.kind === 'command') commands += 1;
		if (item.kind !== 'tool') continue;
		if (actions[index] === 'search') searches += 1;
		if (actions[index] === 'command') commands += 1;
	}

	const clauses: string[] = [];
	const onlyFile = files[0];
	if (files.length === 1 && onlyFile !== undefined) clauses.push(basename(onlyFile));
	else if (files.length > 1) clauses.push(pluralize(files.length, 'file'));
	if (searches > 0) clauses.push(pluralize(searches, 'search', 'searches'));
	if (commands > 0) clauses.push(`ran ${pluralize(commands, 'command')}`);

	if (clauses.length === 0) {
		const seconds = actions.every((action) => action === null) ? thoughtSeconds(items) : null;
		clauses.push(seconds === null ? pluralize(items.length, 'step') : `for ${seconds}s`);
	}

	return capDetail(clauses);
}

function distinctFiles(
	items: readonly MachineActivityItem[],
	actions: readonly (ToolActionKind | null)[],
): string[] {
	const paths = new Set<string>();
	for (const [index, item] of items.entries()) {
		const raw = filePathOf(item, actions[index] ?? null);
		if (raw === null) continue;
		const canonical = canonicalChangedPath(raw);
		if (canonical) paths.add(canonical);
	}
	return [...paths];
}

function filePathOf(item: MachineActivityItem, action: ToolActionKind | null): string | null {
	if (item.kind === 'file') return item.path;
	if (item.kind !== 'tool') return null;
	if (action !== 'read' && action !== 'edit') return null;
	return stringField(item.tool.input, TOOL_PATH_KEYS);
}

function thoughtSeconds(items: readonly MachineActivityItem[]): number | null {
	let total = 0;
	let measured = false;
	for (const item of items) {
		if (item.kind !== 'thought' || item.durationSeconds === null) continue;
		total += item.durationSeconds;
		measured = true;
	}
	if (!measured) return null;
	const rounded = Math.round(total);
	return rounded >= 1 ? rounded : null;
}

function capDetail(clauses: readonly string[]): string {
	const kept = [...clauses];
	while (kept.length > 1 && kept.join(', ').length > ACTIVITY_GROUP_DETAIL_MAX_CHARS) kept.pop();
	const detail = kept.join(', ');
	if (detail.length <= ACTIVITY_GROUP_DETAIL_MAX_CHARS) return detail;
	return `${detail.slice(0, ACTIVITY_GROUP_DETAIL_MAX_CHARS - 1)}…`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function basename(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? path : path.slice(index + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(input: unknown, keys: readonly string[]): string | null {
	if (!isRecord(input)) return null;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}
