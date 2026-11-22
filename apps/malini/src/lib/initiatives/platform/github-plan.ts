import { INITIATIVE_TITLE_MAX_LENGTH } from '$contract/initiatives';
import { isRecord } from '$main/db/rows';

export type RemoteMilestone = Readonly<{
	number: number;
	title: string;
	dueOn: string | null;
	note: string;
	open: boolean;
	author: string | null;
}>;

export type RemoteIssue = Readonly<{
	number: number;
	milestone: number;
	title: string;
	done: boolean;
	note: string;
	assignee: string | null;
	author: string | null;
	closedBy: string | null;
	people: readonly string[];
}>;

const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;

const DUE_DAY = /^\d{4}-\d{2}-\d{2}/u;

export function isGithubRepository(fullName: string): boolean {
	return GITHUB_REPOSITORY.test(fullName) && !fullName.endsWith('/..') && !fullName.endsWith('/.');
}

export function remoteMilestones(raw: readonly unknown[]): RemoteMilestone[] {
	return raw.flatMap((item) => {
		if (!isRecord(item)) return [];
		const number = item['number'];
		const title = oneLine(item['title']);
		if (!isNumber(number) || title === null) return [];
		const due = item['due_on'];
		return [
			{
				number,
				title,
				dueOn: typeof due === 'string' && DUE_DAY.test(due) ? due.slice(0, 10) : null,
				note: plainText(item['description']),
				open: item['state'] === 'open',
				author: login(item['creator']),
			},
		];
	});
}

export function remoteIssues(raw: readonly unknown[]): RemoteIssue[] {
	return raw.flatMap((item) => {
		if (!isRecord(item) || item['pull_request'] !== undefined) return [];
		const number = item['number'];
		const milestone = isRecord(item['milestone']) ? item['milestone']['number'] : undefined;
		const title = oneLine(item['title']);
		if (!isNumber(number) || !isNumber(milestone) || title === null) return [];
		const assignees = Array.isArray(item['assignees']) ? item['assignees'].map(login) : [];
		const author = login(item['user']);
		const closedBy = login(item['closed_by']);
		return [
			{
				number,
				milestone,
				title,
				done: item['state'] === 'closed',
				note: plainText(item['body']),
				assignee: assignees[0] ?? login(item['assignee']),
				author,
				closedBy,
				people: [author, closedBy, ...assignees].filter((name) => name !== null),
			},
		];
	});
}

export function dueInstant(day: string): string {
	return `${day}T12:00:00Z`;
}

// ponytail: plain text lines both ways, formatting is lost once GitHub edits a note; upgrade with prosemirror-markdown on the scratchpad schema
export function noteText(note: string | null): string {
	if (note === null) return '';
	try {
		const doc: unknown = JSON.parse(note);
		return normalized(blockLines(doc).join('\n'));
	} catch {
		return '';
	}
}

export function noteFromText(text: string): string | null {
	if (text === '') return null;
	const content = text
		.split('\n')
		.map((line) =>
			line === ''
				? { type: 'paragraph' }
				: { type: 'paragraph', content: [{ type: 'text', text: line }] },
		);
	return JSON.stringify({ type: 'doc', content });
}

function blockLines(node: unknown): string[] {
	if (!isRecord(node)) return [];
	const content: unknown[] = Array.isArray(node['content']) ? node['content'] : [];
	const inline = content.some((child) => isRecord(child) && isInline(child));
	if (!inline && node['type'] !== 'paragraph' && node['type'] !== 'heading') {
		return content.flatMap(blockLines);
	}
	return content.map(inlineText).join('').split('\n');
}

function isInline(node: Record<string, unknown>): boolean {
	return node['type'] === 'text' || node['type'] === 'hardBreak';
}

function inlineText(node: unknown): string {
	if (!isRecord(node)) return '';
	if (node['type'] === 'hardBreak') return '\n';
	return typeof node['text'] === 'string' ? node['text'] : '';
}

function plainText(value: unknown): string {
	return typeof value === 'string' ? normalized(value) : '';
}

function normalized(text: string): string {
	return text.replace(/\r\n?/gu, '\n').trimEnd();
}

function oneLine(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const title = value.replace(/\s+/gu, ' ').trim().slice(0, INITIATIVE_TITLE_MAX_LENGTH);
	return title.length === 0 ? null : title;
}

function login(value: unknown): string | null {
	return isRecord(value) && typeof value['login'] === 'string' ? value['login'] : null;
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function eventActor(events: unknown, event: string): string | null {
	if (!Array.isArray(events)) return null;
	const latest = events.filter((item) => isRecord(item) && item['event'] === event).at(-1);
	return isRecord(latest) ? login(latest['actor']) : null;
}
