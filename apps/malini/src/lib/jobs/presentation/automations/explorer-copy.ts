import { parseAutomationTrigger } from '$contract/automation-trigger';
import type { EventChannel } from '$contract/events';
import type { JobDefinitionRecord, LoggedEventRecord, ShippingWait } from '$contract/jobs';
import type { ShipAllButton, ShipButton, ShipStep } from '$contract/pull-requests';
import type { IconName } from '$hyper-ui/icons';
import {
	EVENT_ROWS,
	eventRow,
	type EventRow,
	type Explorer,
	type ExplorerItem,
	type MapNode,
	type Source,
} from '$lib/jobs/domain/explorer';
import { RECONCILER_RULES, RULE_EVENTS, type ReconcilerRule } from '$lib/jobs/domain/reconciler';
import { DECIDERS, decisionAction, decisionQuestion } from './decision-copy';

export type Look = Readonly<{ label: string; icon: IconName }>;

export type Mark = Readonly<{ label: string; tone: string }>;

export const ROW_LOOKS: Readonly<Record<EventRow, Look>> = {
	'button-clicked': { label: 'Button clicked', icon: 'pick-element' },
	'workstream-opened': { label: 'Workstream opened', icon: 'folder-open' },
	'turn-finished': { label: 'Turn finished', icon: 'chat' },
	'tool-called': { label: 'Tool called', icon: 'plug' },
	'job-started': { label: 'Job started', icon: 'play' },
	'job-finished': { label: 'Job finished', icon: 'check' },
	'head-moved': { label: 'Head moved', icon: 'commit' },
	'files-changed': { label: 'Files changed', icon: 'files' },
	'branch-pushed': { label: 'Branch pushed', icon: 'arrow-up' },
	'merge-conflicted': { label: 'Merge conflicted', icon: 'swap' },
	'pull-request-changed': { label: 'Pull request changed', icon: 'pr-open' },
	'workstream-created': { label: 'Workstream created', icon: 'folder-plus' },
	'workstream-archived': { label: 'Workstream archived', icon: 'archive' },
	'malini-started': { label: 'Malini started', icon: 'refresh' },
	'malini-updated': { label: 'Malini updated', icon: 'cloud-download' },
	'time-reached': { label: 'Time reached', icon: 'clock' },
	other: { label: 'Other', icon: 'more' },
};

export const RULE_LABELS: Readonly<Record<ReconcilerRule, string>> = {
	triggers: 'Your triggers',
	thens: 'Thens',
	shipping: 'Shipping',
	resume: 'Resume',
	schedules: 'Schedules',
	compatibility: 'Compatibility',
	model: 'Choose a reaction',
};

export const SOURCE_LABELS: Readonly<Record<Source, string>> = {
	you: 'You',
	agent: 'agent',
	git: 'git',
	github: 'GitHub',
	malini: 'Malini',
	clock: 'clock',
};

const MERGED: Mark = { label: 'merged', tone: 'text-merged-content' };
const FAILED: Mark = { label: 'failed', tone: 'text-error-content' };
const NEEDS_YOU: Mark = { label: 'needs you', tone: 'text-warning-content' };
const SHORT_SHA = 7;
const HOUR_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const LIST = new Intl.ListFormat('en', { type: 'conjunction' });
const PROPER_NOUN = /^(?:Malini|MCP)\b/u;

const SHIP_STEPS: ReadonlyMap<string, string> = new Map(
	Object.entries({
		'waiting-for-agent': 'waiting for the chat to finish',
		'opening-draft': 'opening a draft pull request',
		pushing: 'pushing',
		'marking-ready': 'marking the pull request ready',
		'updating-branch': 'updating the branch',
		'updating-from-main': 'updating from main',
		'resolving-conflicts': 'resolving conflicts',
		'fixing-checks': 'fixing checks',
		'addressing-review': 'addressing review',
		'waiting-for-checks': 'waiting for checks',
		'waiting-for-review': 'waiting for review',
		'waiting-for-github': 'waiting for GitHub',
		merging: 'merging',
		archiving: 'archiving the workstream',
	} satisfies Record<ShipStep, string>),
);

const SHIP_BUTTONS: ReadonlyMap<string, string> = new Map(
	Object.entries({
		draft: 'Draft',
		merge: 'Merge',
		retry: 'Retry',
		cancel: 'Cancel',
		keep: 'Keep',
		'draft-all': 'Draft all',
		'merge-all': 'Merge all',
	} satisfies Record<ShipButton | ShipAllButton, string>),
);

const SHIPPING_WAITS: ReadonlyMap<string, string> = new Map(
	Object.entries({ retry: 'Retry', checks: 'Checks rerun' } satisfies Record<ShippingWait, string>),
);

const YOU_DID: Readonly<Partial<Record<EventRow, string>>> = {
	'button-clicked': 'You clicked it',
	'workstream-opened': 'You opened it',
};

type Payload = Readonly<Record<string, unknown>>;

const INSTALL_VERBS: ReadonlyMap<string, string> = new Map([
	['running', 'started'],
	['succeeded', 'finished'],
	['failed', 'failed'],
	['skipped', 'skipped'],
	['aborted', 'stopped'],
]);

const EVENT_NAMES: Readonly<Record<string, (payload: Payload) => string>> = {
	'chat:session-renamed': () => 'Chat renamed',
	'chat:run-changes-captured': () => 'Changes captured',
	'chat:mcp-server-changed': () => 'MCP server changed',
	'repositories:workstream-removed': (payload) =>
		payload['deleted'] === true ? 'Workstream deleted' : 'Workstream archived',
	'repositories:workstream-files-changed': () => 'Files changed',
	'repositories:workstream-setup-status': (payload) =>
		payload['status'] === 'done' ? 'Setup finished' : 'Setup started',
	'repositories:workstream-install-status': (payload) =>
		`Install ${INSTALL_VERBS.get(text(payload['status']) ?? '') ?? 'changed'}`,
	'repositories:changed': () => 'Repositories changed',
	'pull-requests:ship-changed': () => 'Shipping changed',
	'jobs:definition-changed': (payload) =>
		payload['definition'] === null ? 'Job deleted' : 'Job saved',
	'jobs:suggested': () => 'Job suggested',
	'app:updated': () => 'Malini updated',
	'app:update-staged': () => 'Update downloaded',
} satisfies Partial<Record<EventChannel, (payload: Payload) => string>>;

const EVENT_DETAILS: Readonly<Record<string, (payload: Payload) => string | null>> = {
	'chat:turn-finished': (payload) => text(payload['outcome']),
	'chat:session-renamed': (payload) => quoted(payload['name']),
	'repositories:workstream-renamed': (payload) => quoted(payload['name']),
	'repositories:workstream-head-moved': (payload) => sha(payload['head']),
	'repositories:workstream-pushed': (payload) => sha(payload['head']),
	'repositories:workstream-merge-conflicted': (payload) =>
		count(strings(payload['conflictedPaths']).length, 'file'),
	'repositories:workstream-files-changed': (payload) => {
		const paths = strings(payload['paths']).length;
		return paths === 0 ? null : count(paths, 'file');
	},
	'pull-requests:pull-request-changed': pullRequestDetails,
	'pull-requests:ship-changed': shipDetails,
	'pull-requests:button-clicked': (payload) =>
		SHIP_BUTTONS.get(text(payload['button']) ?? '') ?? null,
	'jobs:run-started': (payload) => text(record(payload['run'])['title']),
	'jobs:run-finished': (payload) => text(record(payload['run'])['title']),
	'jobs:tool-called': (payload) => text(record(payload['action'])['tool']),
	'jobs:time-reached': (payload) =>
		text(payload['name']) ?? SHIPPING_WAITS.get(text(payload['wait']) ?? '') ?? null,
	'app:started': (payload) => text(payload['version']),
	'app:updated': (payload) => text(payload['to']),
	'app:update-staged': (payload) => text(payload['version']),
} satisfies Partial<Record<EventChannel, (payload: Payload) => string | null>>;

const NODE_LABELS: ReadonlyMap<MapNode, string> = new Map<MapNode, string>([
	['you', 'You'],
	['reconciler', 'Reconciler'],
	['chats', 'Chats'],
	['jobs', 'Jobs'],
	...EVENT_ROWS.map((row) => [`event:${row}`, ROW_LOOKS[row].label] as const),
	...RECONCILER_RULES.map((rule) => [`rule:${rule}`, RULE_LABELS[rule]] as const),
]);

export function nodeLabel(node: MapNode): string {
	return NODE_LABELS.get(node) ?? node;
}

export function ruleNote(rule: ReconcilerRule, jobs: readonly JobDefinitionRecord[]): string {
	const heard = RULE_EVENTS[rule];
	if (heard === 'every') {
		const listening = jobs.filter((job) => triggerKind(job) === 'event').length;
		return listening === 0 ? 'no job has an event trigger on' : `${count(listening, 'job')} listen`;
	}
	const [first = '', ...rest] = heard.map(channelName);
	return rest.length === 0 ? `on ${first}` : `on ${first} and ${rest.length} more`;
}

export function nodeNote(node: MapNode): string {
	const rule = RECONCILER_RULES.find((candidate) => node === `rule:${candidate}`);
	if (rule === undefined) return 'the latest that passed through it';
	const heard = RULE_EVENTS[rule];
	return heard === 'every'
		? "hears every event a job's trigger names"
		: `hears ${LIST.format(heard.map(channelName))}`;
}

function channelName(channel: EventChannel): string {
	return ROW_LOOKS[eventRow(channel)].label;
}

export function itemTitle(item: ExplorerItem): string {
	switch (item.kind) {
		case 'event':
			return eventTitle(item.event);
		case 'run':
			return item.run.requests > 1
				? `${item.run.title}, asked ${item.run.requests} times`
				: item.run.title;
		case 'turn':
			return item.turn.prompt || item.turn.chatName || 'Chat turn';
		case 'decision':
			return item.decision.candidates[item.decision.chosen]?.kind === 'ask-you'
				? decisionQuestion(item.decision)
				: decisionAction(item.decision);
	}
}

export function itemIcon(item: ExplorerItem): IconName {
	switch (item.kind) {
		case 'event':
			return isMerge(item.event) ? 'pr-merged' : ROW_LOOKS[item.row].icon;
		case 'run':
			return 'wrench';
		case 'turn':
			return 'chat';
		case 'decision':
			return 'route';
	}
}

export function itemWhy(item: ExplorerItem, explorer: Explorer): string {
	const cause = item.cause === null ? null : (explorer.byId.get(item.cause) ?? null);
	switch (item.kind) {
		case 'turn':
			if (item.turn.resumed) return 'Malini resumed it';
			if (item.turn.causeEventId !== null) return 'Choose a reaction woke it';
			if (item.turn.from !== null) {
				return `Asked by ${explorer.workstreams.get(item.turn.from)?.name ?? 'a chat'}`;
			}
			return 'You asked';
		case 'run':
			return runWhy(item, cause);
		case 'decision':
			return DECIDERS[item.decision.decidedBy];
		case 'event':
			return (
				YOU_DID[item.row] ?? (cause === null ? 'Malini noticed it' : `from ${shortTitle(cause)}`)
			);
	}
}

export function itemMark(item: ExplorerItem): Mark | null {
	switch (item.kind) {
		case 'run':
			if (item.run.status === 'failed') return FAILED;
			return item.run.status === 'needs-you' || item.run.status === 'waiting' ? NEEDS_YOU : null;
		case 'turn':
			return item.turn.status === 'failed' ? FAILED : null;
		case 'decision':
			if (item.decision.status === 'failed') return FAILED;
			return item.decision.status === 'asking' ? NEEDS_YOU : null;
		case 'event':
			return eventMark(item.event);
	}
}

export function itemNote(item: ExplorerItem): string | null {
	if (item.kind === 'event') return eventNote(item.event);
	if (item.kind === 'turn') {
		if (item.turn.status === 'running') return 'working';
		if (item.turn.status === 'interrupted') return 'interrupted';
		return item.turn.status === 'cancelled' ? 'stopped' : null;
	}
	if (item.kind !== 'run') return null;
	if (item.run.status === 'running') return 'running';
	if (item.run.status === 'queued') return 'queued';
	return item.run.status === 'cancelled' ? 'cancelled' : null;
}

export function explorerClock(at: number): string {
	return HOUR_FORMAT.format(new Date(at));
}

export function count(value: number, noun: string): string {
	return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

function triggerKind(job: JobDefinitionRecord): string | null {
	if (job.trigger === null || job.trigger.mode === 'off') return null;
	return parseAutomationTrigger(job.trigger.when).kind;
}

function runWhy(
	item: ExplorerItem & Readonly<{ kind: 'run' }>,
	cause: ExplorerItem | null,
): string {
	switch (item.run.origin) {
		case 'merge-queue':
			if (cause?.kind !== 'event') return 'Shipping ran it';
			return cause.row === 'pull-request-changed'
				? `${pullRequestName(record(cause.event.payload))} changed on GitHub`
				: `Shipping heard ${shortTitle(cause)}`;
		case 'trigger':
			return cause === null ? 'Its trigger ran it' : `Its trigger heard ${shortTitle(cause)}`;
		case 'then':
			return cause?.kind === 'run' ? `Ran after ${cause.run.title}` : 'Ran after another job';
		case 'schedule':
			return 'Its schedule ran it';
		case 'compatibility':
			return cause === null ? 'Compatibility ran it' : `Compatibility heard ${shortTitle(cause)}`;
		case 'reconciler':
			return 'Choose a reaction ran it';
		case 'manual':
			if (item.run.chatAfterRunId !== null) return 'A chat ran it';
			return item.run.parentRunId === null ? 'You ran it' : 'Another job ran it';
	}
}

function shortTitle(item: ExplorerItem): string {
	switch (item.kind) {
		case 'run':
			return item.run.title;
		case 'turn':
			return 'a chat turn';
		case 'decision':
			return 'Choose a reaction';
		case 'event':
			return inSentence(eventName(item.event));
	}
}

function inSentence(name: string): string {
	return PROPER_NOUN.test(name) ? name : `${name.charAt(0).toLocaleLowerCase()}${name.slice(1)}`;
}

function eventTitle(event: LoggedEventRecord): string {
	const details = EVENT_DETAILS[event.channel]?.(record(event.payload)) ?? null;
	return details === null ? eventName(event) : `${eventName(event)}: ${details}`;
}

function eventName(event: LoggedEventRecord): string {
	const named = EVENT_NAMES[event.channel];
	if (named) return named(record(event.payload));
	const row = eventRow(event.channel);
	if (row !== 'other') return ROW_LOOKS[row].label;
	const name = event.channel.slice(event.channel.indexOf(':') + 1).replaceAll('-', ' ');
	return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

function eventNote(event: LoggedEventRecord): string | null {
	const payload = record(event.payload);
	if (event.channel === 'chat:turn-finished' && payload['status'] === 'cancelled') return 'stopped';
	if (event.channel !== 'jobs:run-finished') return null;
	return record(payload['run'])['status'] === 'cancelled' ? 'cancelled' : null;
}

function eventMark(event: LoggedEventRecord): Mark | null {
	const payload = record(event.payload);
	if (isMerge(event)) return MERGED;
	if (event.channel === 'pull-requests:pull-request-changed') {
		return payload['checks'] === 'failed' ? FAILED : null;
	}
	if (event.channel === 'chat:turn-finished') {
		if (payload['status'] === 'failed') return FAILED;
		return text(payload['needs']) ? NEEDS_YOU : null;
	}
	if (event.channel === 'jobs:run-finished') {
		return text(record(payload['run'])['status']) === 'failed' ? FAILED : null;
	}
	return null;
}

function shipDetails(payload: Payload): string | null {
	const merged = record(payload['merged']);
	if (typeof merged['pullRequestNumber'] === 'number') {
		return `#${merged['pullRequestNumber']} merged`;
	}
	const state = record(payload['state']);
	if (payload['state'] === null) return 'stopped';
	const step = SHIP_STEPS.get(text(state['step']) ?? '');
	if (step !== undefined) return step;
	if (state['phase'] === 'needs-you') return 'needs you';
	if (state['phase'] === 'queued') return 'queued to merge';
	return state['phase'] === 'draft' ? 'draft pull request open' : null;
}

function pullRequestDetails(payload: Payload): string {
	const name = pullRequestName(payload);
	if (payload['state'] === 'merged') return `${name} merged`;
	if (payload['state'] === 'closed') return `${name} closed`;
	const shown = payload['state'] === 'draft' ? `draft ${name}` : name;
	const facts = pullRequestFacts(payload);
	return facts.length === 0 ? `${shown} open` : `${shown}, ${facts.join(', ')}`;
}

function pullRequestFacts(payload: Payload): string[] {
	const base = text(payload['baseBranch']) ?? 'its base';
	const behind = whole(payload['behindBase']);
	const threads = whole(payload['unresolvedThreads']);
	const facts = [
		payload['conflicts'] === true ? `conflicts with ${base}` : null,
		payload['checks'] === 'failed' ? failedChecks(strings(payload['failingChecks'])) : null,
		payload['reviewDecision'] === 'changes_requested' ? 'changes requested' : null,
		threads > 0 ? count(threads, 'open review thread') : null,
		behind > 0 ? `${count(behind, 'commit')} behind ${base}` : null,
		payload['checks'] === 'pending' ? 'checks running' : null,
		payload['checks'] === 'success' ? 'checks passed' : null,
		payload['reviewDecision'] === 'approved' ? 'approved' : null,
	];
	return facts.filter((fact) => fact !== null).slice(0, 3);
}

function failedChecks(names: readonly string[]): string {
	if (names.length === 1) return `${names[0]} failed`;
	return names.length === 0 ? 'checks failed' : `${count(names.length, 'check')} failed`;
}

function pullRequestName(payload: Payload): string {
	const number = payload['pullRequestNumber'];
	return typeof number === 'number' ? `#${number}` : 'the pull request';
}

function isMerge(event: LoggedEventRecord): boolean {
	const payload = record(event.payload);
	if (event.channel === 'pull-requests:pull-request-changed') return payload['state'] === 'merged';
	return (
		event.channel === 'pull-requests:ship-changed' &&
		typeof record(payload['merged'])['pullRequestNumber'] === 'number'
	);
}

function record(value: unknown): Payload {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sha(value: unknown): string | null {
	return text(value)?.slice(0, SHORT_SHA) ?? null;
}

function quoted(value: unknown): string | null {
	const name = text(value);
	return name === null ? null : `“${name}”`;
}

function whole(value: unknown): number {
	return typeof value === 'number' ? value : 0;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}
