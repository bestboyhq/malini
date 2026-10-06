import type { RenderItem, RunGroup } from './render-state';
import { relativizeWorkstreamPath } from './workstream-path';

export type RunTimelineThought = {
	contentId: string;
	seq: number;
	text: string;
	durationSeconds: number | null;
};

export type RunTimelineItem =
	| Exclude<RenderItem, { kind: 'terminal' | 'usage' }>
	| (RunTimelineThought & { kind: 'thought'; key: string });

function stringAt(input: unknown, keys: readonly string[]): string | null {
	if (!isRecord(input)) return null;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
	'applypatch',
	'create',
	'createfile',
	'edit',
	'editfile',
	'insertedit',
	'multiedit',
	'notebookedit',
	'patch',
	'patchfile',
	'replaceinfile',
	'searchreplace',
	'strreplacebasededittool',
	'strreplaceeditor',
	'update',
	'updatefile',
	'write',
	'writefile',
]);

const MUTATION_ACTIONS = ['edit', 'write', 'create', 'update', 'patch'] as const;

function mutationTool(name: string): boolean {
	const local = name.toLowerCase().split('__').at(-1) ?? '';
	const compact = local.replace(/[^a-z0-9]+/gu, '');
	if (MUTATION_TOOL_NAMES.has(compact)) return true;
	return MUTATION_ACTIONS.some((action) => compact.includes(`${action}file`));
}

export function canonicalChangedPath(value: string): string {
	const normalized = relativizeWorkstreamPath(value.trim().replaceAll('\\', '/'));
	return normalized
		.replace(/^(?:\.\/)+/u, '')
		.replace(/^\/+/u, '')
		.replace(/\/+$/u, '');
}

export function changedPathsMatch(left: string, right: string): boolean {
	if (!left || !right) return false;
	if (left === right) return true;
	return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function pathBasename(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? path : path.slice(index + 1);
}

export class ChangedPathSet {
	readonly #earliestSeqByPath = new Map<string, number>();
	readonly #byBasename = new Map<string, string[]>();

	get size(): number {
		return this.#earliestSeqByPath.size;
	}

	add(value: string, seq: number = Number.NEGATIVE_INFINITY): void {
		const canonical = canonicalChangedPath(value);
		if (!canonical) return;
		const existing = this.#earliestSeqByPath.get(canonical);
		if (existing !== undefined) {
			if (seq < existing) this.#earliestSeqByPath.set(canonical, seq);
			return;
		}
		this.#earliestSeqByPath.set(canonical, seq);
		const key = pathBasename(canonical);
		const bucket = this.#byBasename.get(key);
		if (bucket) bucket.push(canonical);
		else this.#byBasename.set(key, [canonical]);
	}

	has(value: string, seq: number = Number.POSITIVE_INFINITY): boolean {
		const canonical = canonicalChangedPath(value);
		if (!canonical) return false;
		const exact = this.#earliestSeqByPath.get(canonical);
		if (exact !== undefined && exact <= seq) return true;
		const bucket = this.#byBasename.get(pathBasename(canonical));
		return (
			bucket?.some((candidate) => {
				if (!changedPathsMatch(candidate, canonical)) return false;
				return (this.#earliestSeqByPath.get(candidate) ?? Number.POSITIVE_INFINITY) <= seq;
			}) ?? false
		);
	}
}

export function commandRepresentedByTool(
	item: Extract<RenderItem, { kind: 'tool' }>,
): string | null {
	return stringAt(item.tool.input, ['command', 'cmd']);
}

export function mutationRepresentedByTool(
	item: Extract<RenderItem, { kind: 'tool' }>,
): string | null {
	if (!mutationTool(item.tool.name)) return null;
	return stringAt(item.tool.input, ['file_path', 'path', 'filePath', 'notebook_path']);
}

export function representedBridgeEvents(run: RunGroup): {
	commands: ReadonlySet<string>;
	mutations: ChangedPathSet;
} {
	const commands = new Set<string>();
	const mutations = new ChangedPathSet();
	for (const item of run.items) {
		if (item.kind !== 'tool') continue;
		const command = commandRepresentedByTool(item);
		if (command) commands.add(command);
		const path = mutationRepresentedByTool(item);
		if (path) mutations.add(path, item.seq);
	}
	return { commands, mutations };
}

export function linearizeRunTimeline(
	run: RunGroup,
	thoughts: readonly RunTimelineThought[],
): RunTimelineItem[] {
	const represented = representedBridgeEvents(run);
	const durable = run.items.filter(
		(item): item is Exclude<RenderItem, { kind: 'terminal' | 'usage' }> => {
			if (item.kind === 'terminal' || item.kind === 'usage') return false;
			if (item.kind === 'command') return !represented.commands.has(item.command.trim());
			if (item.kind === 'file') return !represented.mutations.has(item.path, item.seq);
			return true;
		},
	);
	const reasoning: RunTimelineItem[] = thoughts.map((thought) => ({
		...thought,
		kind: 'thought',
		key: `thought-${run.runId}-${thought.contentId}`,
	}));
	return [...durable, ...reasoning].sort(
		(left, right) => left.seq - right.seq || left.key.localeCompare(right.key),
	);
}
