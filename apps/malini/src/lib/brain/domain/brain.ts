import type { BrainDocument, BrainEntry, BrainStatus } from '$contract/brain';

export type BrainDocumentState =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'ready'; document: BrainDocument }>
	| Readonly<{ status: 'failed'; error: string }>;

export type BrainTopic = Readonly<{
	key: string;
	title: string;
	entry: BrainEntry | null;
	children: readonly BrainEntry[];
}>;

export type BrainLogDay = Readonly<{ entry: BrainEntry; day: string; label: string }>;

export type BrainSync =
	| Readonly<{ kind: 'problem'; problem: string }>
	| Readonly<{ kind: 'local' }>
	| Readonly<{ kind: 'waiting'; unpushed: number }>
	| Readonly<{ kind: 'synced'; repository: string; syncedAt: string | null }>;

const NOTES = 'notes/';
const MARKDOWN = '.md';
const LOG_DAY = /^log\/(\d{4}-\d{2}-\d{2})\.md$/u;
const WIKI_LOG_DAY = /\[\[(log\/\d{4}-\d{2}-\d{2})(?:\|[^\]\n]*)?\]\]/gu;
const LEADING_TITLE = /^\s*# [^\n]*\n?/u;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC',
});
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function topicTitle(stem: string): string {
	const words = stem.replaceAll(/[-_]+/gu, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function byTitle(left: { title: string }, right: { title: string }): number {
	return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

export function brainTopics(entries: readonly BrainEntry[]): BrainTopic[] {
	const topics = new Map<string, { entry: BrainEntry | null; children: BrainEntry[] }>();
	for (const entry of entries) {
		if (entry.kind !== 'note' || !entry.path.startsWith(NOTES)) continue;
		const [key = '', ...rest] = entry.path.slice(NOTES.length, -MARKDOWN.length).split('/');
		const topic = topics.get(key) ?? { entry: null, children: [] };
		if (rest.length === 0) topic.entry = entry;
		else topic.children.push(entry);
		topics.set(key, topic);
	}
	return [...topics]
		.map(([key, topic]) => ({
			key,
			title: topicTitle(key),
			entry: topic.entry,
			children: topic.children.sort(byTitle),
		}))
		.sort(byTitle);
}

export function brainLogDayLabel(day: string): string {
	return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

export function brainLogDays(entries: readonly BrainEntry[]): BrainLogDay[] {
	return entries
		.flatMap((entry): BrainLogDay[] => {
			const day = LOG_DAY.exec(entry.path)?.[1];
			return entry.kind === 'log' && day ? [{ entry, day, label: brainLogDayLabel(day) }] : [];
		})
		.sort((left, right) => right.day.localeCompare(left.day));
}

export function wikiLinkPath(target: string, entries: readonly BrainEntry[]): string | null {
	const path = target.trim().replace(/\.md$/u, '');
	if (path.length === 0) return null;
	const exact = `${path}${MARKDOWN}`;
	if (entries.some((entry) => entry.path === exact)) return exact;
	const nested = entries.find((entry) => entry.path.endsWith(`/${exact}`));
	if (nested) return nested.path;
	return LOG_DAY.test(exact) || exact.startsWith(NOTES) ? exact : null;
}

export function linkedLogDays(text: string): string[] {
	return [...new Set([...text.matchAll(WIKI_LOG_DAY)].map((match) => match[1] ?? ''))]
		.filter(Boolean)
		.sort((left, right) => right.localeCompare(left));
}

export function brainBody(text: string): string {
	return text.replace(LEADING_TITLE, '').trimStart();
}

export function brainCrumb(path: string): string {
	return path.replace(/\.md$/u, '').split('/').slice(0, -1).join(' / ') || path;
}

export function brainLogDayOf(path: string): string | null {
	return LOG_DAY.exec(path)?.[1] ?? null;
}

export function rewrittenLine(updatedAt: string | null, logDays: number): string | null {
	if (updatedAt === null) return null;
	const day = SHORT_DAY_FORMAT.format(new Date(updatedAt));
	if (logDays === 0) return `Rewritten ${day}`;
	return `Rewritten ${day} from ${logDays} log ${logDays === 1 ? 'day' : 'days'}`;
}

export function brainSync(status: BrainStatus): BrainSync {
	if (status.problem) return { kind: 'problem', problem: status.problem };
	if (!status.sync || status.repository === null) return { kind: 'local' };
	if (status.unpushed > 0) return { kind: 'waiting', unpushed: status.unpushed };
	return { kind: 'synced', repository: status.repository, syncedAt: status.syncedAt };
}

export function agoLabel(at: string, now: number): string {
	const elapsed = Math.max(0, now - Date.parse(at));
	if (elapsed < MINUTE_MS) return 'just now';
	if (elapsed < HOUR_MS) return RELATIVE_FORMAT.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
	if (elapsed < DAY_MS) return RELATIVE_FORMAT.format(-Math.floor(elapsed / HOUR_MS), 'hour');
	return RELATIVE_FORMAT.format(-Math.floor(elapsed / DAY_MS), 'day');
}

export function brainSyncLine(sync: BrainSync, now: number): string {
	if (sync.kind === 'problem') return sync.problem;
	if (sync.kind === 'local') return 'On this Mac';
	if (sync.kind === 'waiting') {
		return sync.unpushed === 1 ? '1 change waits to push' : `${sync.unpushed} changes wait to push`;
	}
	return sync.syncedAt === null
		? `Synced to ${sync.repository}`
		: `Synced to ${sync.repository}, ${agoLabel(sync.syncedAt, now)}`;
}

export function defaultBrainPath(entries: readonly BrainEntry[]): string | null {
	const [topic] = brainTopics(entries);
	return topic?.entry?.path ?? topic?.children[0]?.path ?? null;
}

export function inTopic(topic: BrainTopic, path: string | null): boolean {
	return path !== null && (path === topic.entry?.path || path.startsWith(`${NOTES}${topic.key}/`));
}
