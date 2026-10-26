import { parseAutomationTrigger } from '$contract/automation-trigger';
import type { JobDefinitionRecord, LoggedEventRecord } from '$contract/jobs';
import type { ShipStep } from '$contract/pull-requests';
import type { IconName } from '$hyper-ui/icons';
import {
	EVENT_ROWS,
	LISTENERS,
	type EventRow,
	type Explorer,
	type ExplorerItem,
	type Listener,
	type MapNode,
	type SourceNode,
} from '$lib/jobs/domain/explorer';
import { DECIDERS, decisionAction, decisionQuestion } from './decision-copy';

export type Look = Readonly<{ label: string; icon: IconName }>;

export type Mark = Readonly<{ label: string; tone: string }>;

export const ROW_LOOKS: Readonly<Record<EventRow, Look>> = {
	'turn-ended': { label: 'Turn ended', icon: 'chat' },
	'tool-called': { label: 'Tool called', icon: 'plug' },
	committed: { label: 'Committed', icon: 'commit' },
	pushed: { label: 'Pushed', icon: 'arrow-up' },
	conflicted: { label: 'Conflicts', icon: 'swap' },
	'pull-request': { label: 'Pull request', icon: 'pr-open' },
	'workstream-started': { label: 'New workstream', icon: 'folder-plus' },
	'workstream-archived': { label: 'Archived', icon: 'archive' },
	'job-run': { label: 'Job run', icon: 'wrench' },
	other: { label: 'Other', icon: 'more' },
};

export const LISTENER_LABELS: Readonly<Record<Listener, string>> = {
	reconciler: 'Reconcile events',
	triggers: 'Your triggers',
	thens: 'Thens',
	'merge-queue': 'Merge queue',
	schedules: 'Schedules',
	resume: 'Resume',
};

export const SOURCE_LOOKS: Readonly<Record<SourceNode, Readonly<{ label: string; note: string }>>> =
	{
		you: { label: 'You', note: 'prompts and clicks' },
		git: { label: 'Git', note: 'commits, pushes, conflicts' },
		github: { label: 'GitHub', note: 'pull requests' },
		malini: { label: 'Malini', note: 'workstreams, restarts' },
	};

const MERGED: Mark = { label: 'merged', tone: 'text-merged-content' };
const FAILED: Mark = { label: 'failed', tone: 'text-error-content' };
const NEEDS_YOU: Mark = { label: 'needs you', tone: 'text-warning-content' };
const SHORT_SHA = 7;
const HOUR_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const SHIP_STEPS: Readonly<Record<ShipStep, string>> = {
	'waiting-for-agent': 'waits for the chat to finish',
	'opening-draft': 'opens a draft pull request',
	pushing: 'pushes',
	'marking-ready': 'marks the pull request ready',
	'updating-branch': 'updates the branch',
	'updating-from-main': 'updates from main',
	'resolving-conflicts': 'resolves conflicts',
	'fixing-checks': 'fixes checks',
	'addressing-review': 'addresses review',
	'waiting-for-checks': 'waits for checks',
	'waiting-for-review': 'waits for review',
	'waiting-for-github': 'waits for GitHub',
	merging: 'merges',
	archiving: 'archives the workstream',
};

type EventTitle = (payload: Readonly<Record<string, unknown>>) => string;

const EVENT_TITLES: Readonly<Record<string, EventTitle>> = {
	'chat:turn-finished': (payload) => {
		if (payload['status'] === 'failed') return 'Turn failed';
		if (payload['status'] === 'cancelled') return 'Turn stopped';
		const outcome = text(payload['outcome']);
		return outcome ? `Turn ended: ${outcome}` : 'Turn ended';
	},
	'chat:session-renamed': (payload) => `Chat named “${text(payload['name']) ?? 'a chat'}”`,
	'chat:run-changes-captured': () => 'Changes of a turn recorded',
	'repositories:workstream-head-moved': (payload) => `Committed ${sha(payload['head'])}`,
	'repositories:workstream-pushed': (payload) => `Pushed ${sha(payload['head'])} to origin`,
	'repositories:workstream-merge-conflicted': (payload) => {
		const paths = Array.isArray(payload['conflictedPaths']) ? payload['conflictedPaths'].length : 0;
		return `Merge stopped on conflicts in ${paths} ${paths === 1 ? 'file' : 'files'}`;
	},
	'repositories:workstream-created': () => 'Workstream started',
	'repositories:workstream-removed': (payload) =>
		payload['archived'] === true ? 'Workstream archived' : 'Workstream removed',
	'repositories:workstream-renamed': (payload) =>
		`Workstream named “${text(payload['name']) ?? 'a workstream'}”`,
	'repositories:workstream-files-changed': (payload) => {
		const paths = Array.isArray(payload['paths']) ? payload['paths'].length : null;
		return paths === null ? 'Files changed' : `${paths} ${paths === 1 ? 'file' : 'files'} changed`;
	},
	'repositories:workstream-setup-status': () => 'Workstream setup moved on',
	'repositories:workstream-install-status': () => 'Dependencies install moved on',
	'repositories:changed': () => 'Repositories changed',
	'pull-requests:ship-changed': shipTitle,
	'pull-requests:local-base-synced': () => 'Local base branch synced',
	'jobs:run-changed': (payload) => {
		const run = record(payload['run']);
		return `${text(run['title']) ?? 'A job'} ${runVerb(text(run['status']))}`;
	},
	'jobs:agent-action-changed': (payload) => {
		const action = record(payload['action']);
		return `Called ${text(action['tool']) ?? 'a Malini tool'}`;
	},
	'app:updated': () => 'Malini updated',
};

const RUN_VERBS: Readonly<Record<string, string>> = {
	waiting: 'waits for you',
	queued: 'is queued',
	running: 'started',
	'needs-you': 'needs you',
	succeeded: 'finished',
	failed: 'failed',
	cancelled: 'was cancelled',
};

const NODE_LABELS: ReadonlyMap<MapNode, string> = new Map<MapNode, string>([
	['you', SOURCE_LOOKS.you.label],
	['git', SOURCE_LOOKS.git.label],
	['github', SOURCE_LOOKS.github.label],
	['malini', SOURCE_LOOKS.malini.label],
	['chats', 'Chats'],
	['jobs', 'Jobs'],
	...EVENT_ROWS.map((row) => [`event:${row}`, ROW_LOOKS[row].label] as const),
	...LISTENERS.map((listener) => [`listener:${listener}`, LISTENER_LABELS[listener]] as const),
]);

const SHIP_STEP_PHRASES: ReadonlyMap<string, string> = new Map(Object.entries(SHIP_STEPS));

export function nodeLabel(node: MapNode): string {
	return NODE_LABELS.get(node) ?? node;
}

export function listenerNote(listener: Listener, jobs: readonly JobDefinitionRecord[]): string {
	switch (listener) {
		case 'triggers': {
			const listening = jobs.filter((job) => triggerKind(job) === 'event').length;
			return listening === 0
				? 'no job has an event trigger on'
				: `${count(listening, 'job')} listen`;
		}
		case 'thens':
			return jobs.some((job) => job.thenJobId !== null)
				? 'runs a job after another'
				: 'no job runs another after it';
		case 'schedules': {
			const timed = jobs.filter((job) => triggerKind(job) === 'schedule').length;
			return timed === 0 ? 'no job runs on a schedule' : `${count(timed, 'job')} on a clock`;
		}
		case 'merge-queue':
			return 'polls GitHub until it merges';
		case 'reconciler':
			return 'decides what no rule matched';
		case 'resume':
			return 'turns a restart cut short';
	}
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
			return item.event.channel === 'pull-requests:ship-changed' && isMerge(item.event)
				? 'pr-merged'
				: ROW_LOOKS[item.row].icon;
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
			if (item.turn.causeEventId !== null) return 'Reconcile events woke it';
			if (item.turn.from !== null) {
				return `Asked by ${explorer.workstreams.get(item.turn.from)?.name ?? 'a chat'}`;
			}
			return 'You asked';
		case 'run':
			return runWhy(item, cause);
		case 'decision':
			return DECIDERS[item.decision.decidedBy];
		case 'event':
			return cause === null ? 'Malini noticed it' : `from ${shortTitle(cause)}`;
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
			return 'The merge queue ran it';
		case 'trigger':
			return cause === null ? 'Its trigger ran it' : `Its trigger heard ${shortTitle(cause)}`;
		case 'then':
			return cause?.kind === 'run' ? `Ran after ${cause.run.title}` : 'Ran after another job';
		case 'schedule':
			return 'Its schedule ran it';
		case 'reconciler':
			return 'Reconcile events ran it';
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
			return 'Reconcile events';
		case 'event':
			return ROW_LOOKS[item.row].label.toLocaleLowerCase();
	}
}

function eventTitle(event: LoggedEventRecord): string {
	const title = EVENT_TITLES[event.channel];
	return title ? title(record(event.payload)) : event.channel;
}

function eventMark(event: LoggedEventRecord): Mark | null {
	const payload = record(event.payload);
	if (event.channel === 'pull-requests:ship-changed') return isMerge(event) ? MERGED : null;
	if (event.channel === 'chat:turn-finished') {
		if (payload['status'] === 'failed') return FAILED;
		return text(payload['needs']) ? NEEDS_YOU : null;
	}
	if (event.channel === 'jobs:run-changed') {
		return text(record(payload['run'])['status']) === 'failed' ? FAILED : null;
	}
	return null;
}

function shipTitle(payload: Readonly<Record<string, unknown>>): string {
	const merged = record(payload['merged']);
	if (typeof merged['pullRequestNumber'] === 'number') {
		return `Pull request #${merged['pullRequestNumber']} merged`;
	}
	const state = record(payload['state']);
	if (payload['state'] === null) return 'Left the merge queue';
	const step = text(state['step']);
	const phrase = step === null ? undefined : SHIP_STEP_PHRASES.get(step);
	if (phrase !== undefined) return `Merge queue ${phrase}`;
	if (state['phase'] === 'needs-you') return 'Pull request needs you';
	if (state['phase'] === 'queued') return 'Queued to merge';
	return state['phase'] === 'draft' ? 'Draft pull request open' : 'Shipping changed';
}

function isMerge(event: LoggedEventRecord): boolean {
	return typeof record(record(event.payload)['merged'])['pullRequestNumber'] === 'number';
}

function runVerb(status: string | null): string {
	return (status === null ? null : RUN_VERBS[status]) ?? 'changed';
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sha(value: unknown): string {
	return text(value)?.slice(0, SHORT_SHA) ?? 'a commit';
}
