import { INITIATIVE_TITLE_MAX_LENGTH, type PlanRemoteChangeKind } from '$contract/initiatives';
import { SCRATCHPAD_CONTENT_MAX_LENGTH } from '$contract/scratchpad';
import { isScratchpadContent } from '$lib/scratchpad/scratchpad.platform';
import { isRecord } from '$main/db/rows';
import { isDay } from '../domain/initiative';

export const PLAN_FILE = 'plan.json';

export type SharedDependency = Readonly<{
	id: string;
	title: string;
	done: boolean;
	note: string | null;
	assignee: string | null;
}>;

export type SharedOutcome = Readonly<{
	id: string;
	title: string;
	dueOn: string | null;
	done: boolean;
	note: string | null;
	createdAt: string;
	dependencies: readonly SharedDependency[];
}>;

export type SharedPlan = readonly SharedOutcome[];

export type PlanChange = Readonly<{ kind: PlanRemoteChangeKind | 'noted'; title: string }>;

const ID = /^[A-Za-z0-9-]{1,64}$/u;

const LOGIN = /^[A-Za-z0-9-]{1,39}$/u;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

const UNKNOWN_INSTANT = '1970-01-01T00:00:00.000Z';

const VERBS: Readonly<Record<PlanChange['kind'], string>> = {
	added: 'Add',
	removed: 'Remove',
	renamed: 'Rename',
	dated: 'Move',
	closed: 'Close',
	reopened: 'Reopen',
	noted: 'Edit the note of',
};

export function planFileText(plan: SharedPlan): string {
	const outcomes = plan.map((outcome) => ({
		id: outcome.id,
		title: outcome.title,
		dueOn: outcome.dueOn,
		done: outcome.done,
		note: noteValue(outcome.note),
		createdAt: outcome.createdAt,
		dependencies: outcome.dependencies.map((dependency) => ({
			id: dependency.id,
			title: dependency.title,
			done: dependency.done,
			note: noteValue(dependency.note),
			assignee: dependency.assignee,
		})),
	}));
	return `${JSON.stringify({ outcomes }, null, '\t')}\n`;
}

export function parsePlanFile(text: string): SharedPlan | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed['outcomes'])) return null;
	const seen = new Set<string>();
	return parsed['outcomes'].flatMap((item) => {
		const outcome = sharedOutcome(item, seen);
		return outcome === null ? [] : [outcome];
	});
}

export function canonicalNote(note: string | null): string | null {
	if (note === null || note.length > SCRATCHPAD_CONTENT_MAX_LENGTH || !isScratchpadContent(note)) {
		return null;
	}
	return JSON.stringify(JSON.parse(note));
}

export function mergePlan(
	base: SharedPlan | null,
	remote: SharedPlan,
	local: SharedPlan,
): SharedPlan {
	const before = byId(base ?? []);
	return mergeById(before, remote, local, (was, theirs, ours) => ({
		id: ours.id,
		title: pick(was?.title, theirs.title, ours.title),
		dueOn: pick(was?.dueOn, theirs.dueOn, ours.dueOn),
		done: pick(was?.done, theirs.done, ours.done),
		note: pick(was?.note, theirs.note, ours.note),
		createdAt: theirs.createdAt,
		dependencies: mergeById(
			byId(was?.dependencies ?? []),
			theirs.dependencies,
			ours.dependencies,
			(wasDependency, theirDependency, ourDependency) => ({
				id: ourDependency.id,
				title: pick(wasDependency?.title, theirDependency.title, ourDependency.title),
				done: pick(wasDependency?.done, theirDependency.done, ourDependency.done),
				note: pick(wasDependency?.note, theirDependency.note, ourDependency.note),
				assignee: pick(wasDependency?.assignee, theirDependency.assignee, ourDependency.assignee),
			}),
		),
	}));
}

export function planChanges(before: SharedPlan, after: SharedPlan): PlanChange[] {
	return changesById(before, after, (was, now) => [
		...fieldChanges(was, now, [
			['title', 'renamed'],
			['dueOn', 'dated'],
			['note', 'noted'],
		]),
		...doneChange(was, now),
		...changesById(was.dependencies, now.dependencies, (wasDependency, nowDependency) => [
			...fieldChanges(wasDependency, nowDependency, [
				['title', 'renamed'],
				['note', 'noted'],
			]),
			...doneChange(wasDependency, nowDependency),
		]),
	]);
}

function doneChange(
	was: Readonly<{ done: boolean }>,
	now: Readonly<{ done: boolean; title: string }>,
): PlanChange[] {
	return was.done === now.done
		? []
		: [{ kind: now.done ? 'closed' : 'reopened', title: now.title }];
}

export function commitMessage(changes: readonly PlanChange[]): string {
	const lines = changes.map(({ kind, title }) => `${VERBS[kind]} ${title}`);
	const [first] = lines;
	if (first === undefined) return 'Update the plan';
	const subject = lines.length === 1 ? first : `${first} and ${lines.length - 1} more`;
	return lines.length === 1 ? `${subject}\n` : `${subject}\n\n${lines.join('\n')}\n`;
}

function sharedOutcome(item: unknown, seen: Set<string>): SharedOutcome | null {
	if (!isRecord(item)) return null;
	const id = sharedId(item['id'], seen);
	const title = oneLine(item['title']);
	if (id === null || title === null) return null;
	const due = item['dueOn'];
	const created = item['createdAt'];
	const dependencies: unknown[] = Array.isArray(item['dependencies']) ? item['dependencies'] : [];
	return {
		id,
		title,
		dueOn: typeof due === 'string' && isDay(due) ? due : null,
		done: item['done'] === true,
		note: noteOf(item['note']),
		createdAt: typeof created === 'string' && INSTANT.test(created) ? created : UNKNOWN_INSTANT,
		dependencies: dependencies.flatMap((dependency) => {
			const shared = sharedDependency(dependency, seen);
			return shared === null ? [] : [shared];
		}),
	};
}

function sharedDependency(item: unknown, seen: Set<string>): SharedDependency | null {
	if (!isRecord(item)) return null;
	const id = sharedId(item['id'], seen);
	const title = oneLine(item['title']);
	if (id === null || title === null) return null;
	const assignee = item['assignee'];
	return {
		id,
		title,
		done: item['done'] === true,
		note: noteOf(item['note']),
		assignee: typeof assignee === 'string' && LOGIN.test(assignee) ? assignee : null,
	};
}

function sharedId(value: unknown, seen: Set<string>): string | null {
	if (typeof value !== 'string' || !ID.test(value) || seen.has(value.toLowerCase())) return null;
	seen.add(value.toLowerCase());
	return value;
}

function oneLine(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const title = value.replace(/\s+/gu, ' ').trim().slice(0, INITIATIVE_TITLE_MAX_LENGTH);
	return title.length === 0 ? null : title;
}

function noteOf(value: unknown): string | null {
	return isRecord(value) ? canonicalNote(JSON.stringify(value)) : null;
}

function noteValue(note: string | null): unknown {
	return note === null ? null : JSON.parse(note);
}

function pick<Value>(base: Value | undefined, remote: Value, local: Value): Value {
	return base !== undefined && remote === base ? local : remote;
}

function byId<Item extends Readonly<{ id: string }>>(items: readonly Item[]): Map<string, Item> {
	return new Map(items.map((item) => [item.id, item]));
}

function mergeById<Item extends Readonly<{ id: string }>>(
	base: ReadonlyMap<string, Item>,
	remote: readonly Item[],
	local: readonly Item[],
	merge: (base: Item | undefined, remote: Item, local: Item) => Item,
): Item[] {
	const ours = byId(local);
	const theirs = byId(remote);
	const kept = remote.flatMap((item) => {
		const mine = ours.get(item.id);
		if (mine !== undefined) return [merge(base.get(item.id), item, mine)];
		return base.has(item.id) ? [] : [item];
	});
	const added = local.filter((item) => !theirs.has(item.id) && !base.has(item.id));
	return [...kept, ...added];
}

function changesById<Item extends Readonly<{ id: string; title: string }>>(
	before: readonly Item[],
	after: readonly Item[],
	changed: (was: Item, now: Item) => PlanChange[],
): PlanChange[] {
	const was = byId(before);
	const now = byId(after);
	return [
		...after.flatMap((item) => {
			const previous = was.get(item.id);
			return previous === undefined
				? [{ kind: 'added', title: item.title } as const]
				: changed(previous, item);
		}),
		...before
			.filter((item) => !now.has(item.id))
			.map((item) => ({ kind: 'removed', title: item.title }) as const),
	];
}

function fieldChanges<Item extends Readonly<{ title: string }>>(
	was: Item,
	now: Item,
	fields: readonly (readonly [keyof Item, PlanChange['kind']])[],
): PlanChange[] {
	return fields.flatMap(([key, kind]) =>
		was[key] === now[key] ? [] : [{ kind, title: now.title }],
	);
}
