import { canonicalChangedPath, type RunTimelineItem } from './run-timeline';
import {
	isBackgroundAgent,
	isCompaction,
	toolActionKind,
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
	shellExitCode,
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
	exitCodes: readonly number[];
};

export type StartedWorkstreams = {
	kind: 'workstreams';
	key: string;
	workstreamIds: readonly string[];
};

export type GroupedRunTimelineItem = RunTimelineItem | ActivityGroup | StartedWorkstreams;

const START_WORKSTREAM_TOOL = 'mcp__malini__workstreams_create';

export const ACTIVITY_GROUP_MIN_ITEMS = 2;

export const ACTIVITY_GROUP_DETAIL_MAX_CHARS = 64;

type MachineActivityItem = Extract<RunTimelineItem, { kind: 'tool' | 'command' | 'file' }>;

type ItemStatus = 'running' | 'completed' | 'failed';

type ActivityVerbStem = 'explore' | 'edit' | 'run' | 'work';

const VERB_FORMS: Readonly<Record<ActivityVerbStem, { past: string; present: string }>> = {
	explore: { past: 'Explored', present: 'Exploring' },
	edit: { past: 'Edited', present: 'Editing' },
	run: { past: 'Ran', present: 'Running' },
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

	for (const item of foldStartedWorkstreams(items)) {
		if (item.kind !== 'workstreams' && isMachineActivity(item)) {
			pending.push(item);
			continue;
		}
		flush();
		grouped.push(item);
	}
	flush();

	return grouped;
}

export function foldStartedWorkstreams(
	items: readonly RunTimelineItem[],
): readonly (RunTimelineItem | StartedWorkstreams)[] {
	const workstreamIds = items.flatMap((item) => startedWorkstreamId(item) ?? []);
	if (workstreamIds.length === 0) return items;
	let shown = false;
	return items.flatMap((item): (RunTimelineItem | StartedWorkstreams)[] => {
		if (startedWorkstreamId(item) === null) return [item];
		if (shown) return [];
		shown = true;
		return [{ kind: 'workstreams', key: `workstreams-${item.key}`, workstreamIds }];
	});
}

function startedWorkstreamId(item: RunTimelineItem): string | null {
	if (item.kind !== 'tool' || item.tool.name !== START_WORKSTREAM_TOOL) return null;
	if (item.tool.status !== 'completed' || typeof item.tool.output !== 'string') return null;
	try {
		const started: unknown = JSON.parse(item.tool.output);
		const id: unknown = isRecord(started) ? started['id'] : null;
		return typeof id === 'string' ? id : null;
	} catch {
		return null;
	}
}

function isMachineActivity(item: RunTimelineItem): item is MachineActivityItem {
	return (
		(item.kind === 'tool' &&
			!isBackgroundAgent(item.tool.name, item.tool.input) &&
			!isCompaction(item.tool.name)) ||
		item.kind === 'command' ||
		item.kind === 'file'
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
		exitCodes: items.map(itemExitCode).filter((code): code is number => code !== null),
	};
}

function itemActionKind(item: MachineActivityItem): ToolActionKind {
	switch (item.kind) {
		case 'tool':
			return toolActionKind(item.tool.name, item.tool.input);
		case 'command':
			return 'command';
		case 'file':
			return 'edit';
	}
}

function itemStatus(item: MachineActivityItem): ItemStatus {
	if (item.kind !== 'tool') return 'completed';
	if (item.tool.autoModeReason || shellExitCode(item.tool.error) !== null) return 'completed';
	return item.tool.status;
}

function itemFailure(item: MachineActivityItem): ActivityFailure | null {
	if (item.kind === 'tool' && itemStatus(item) === 'failed') {
		return {
			key: item.key,
			label:
				toolDescriptionLabel(item.tool.name, item.tool.input) ??
				toolActivityLabel(item.tool.name, item.tool.input),
			message:
				toolFailureReason(item.tool.error) ??
				`${toolDisplayName(item.tool.name, item.tool.input)} failed`,
		};
	}
	return null;
}

function itemExitCode(item: MachineActivityItem): number | null {
	if (item.kind === 'tool') return shellExitCode(item.tool.error);
	if (item.kind === 'command' && item.exitCode) return item.exitCode;
	return null;
}

function groupStatus(statuses: readonly ItemStatus[]): ItemStatus {
	if (statuses.includes('failed')) return 'failed';
	if (statuses.includes('running')) return 'running';
	return 'completed';
}

function distinct(actions: readonly ToolActionKind[]): ToolActionKind[] {
	return [...new Set(actions)];
}

function verbStem(actionKinds: readonly ToolActionKind[]): ActivityVerbStem {
	if (actionKinds.includes('edit')) return 'edit';
	if (actionKinds.every((kind) => kind === 'read' || kind === 'search')) return 'explore';
	if (actionKinds.every((kind) => kind === 'command')) return 'run';
	return 'work';
}

function groupDetail(
	items: readonly MachineActivityItem[],
	actions: readonly ToolActionKind[],
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
	const commandCount = pluralize(commands, 'command');
	if (commands > 0) clauses.push(clauses.length > 0 ? `ran ${commandCount}` : commandCount);

	if (clauses.length === 0) clauses.push(pluralize(items.length, 'step'));

	return capDetail(clauses);
}

function distinctFiles(
	items: readonly MachineActivityItem[],
	actions: readonly ToolActionKind[],
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
