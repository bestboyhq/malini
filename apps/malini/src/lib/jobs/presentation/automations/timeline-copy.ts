import type { LoggedEventRecord } from '$contract/jobs';
import type { TimelineItem } from '$lib/jobs/domain/timeline';
import { JOB_RUN_STATUS } from '../job-run-status';
import { DECISION_STATUS, decisionAction, decisionQuestion } from './decision-copy';

export type TimelineTone = 'done' | 'failed' | 'needs' | 'running' | 'idle';

export const TIMELINE_FILL: Readonly<Record<TimelineTone, string>> = {
	done: 'bg-success-content',
	failed: 'bg-error-content',
	needs: 'bg-warning-content',
	running: 'bg-brand-icon',
	idle: 'bg-status-idle',
};

export const TIMELINE_KIND: Readonly<Record<TimelineItem['kind'], string>> = {
	event: 'Event',
	run: 'Job',
	turn: 'Chat turn',
	decision: 'Reconciler',
};

const SHORT_SHA = 7;

type EventTitle = (payload: Readonly<Record<string, unknown>>) => string;

const EVENT_TITLES: Readonly<Record<string, EventTitle>> = {
	'chat:turn-finished': (payload) => {
		if (payload['status'] === 'failed') return 'Turn failed';
		if (payload['status'] === 'cancelled') return 'Turn stopped';
		const outcome = text(payload['outcome']);
		return outcome ? `Turn ended: ${outcome}` : 'Turn ended';
	},
	'repositories:workstream-head-moved': (payload) => `Head moved to ${sha(payload['head'])}`,
	'repositories:workstream-pushed': (payload) => `Pushed ${sha(payload['head'])} to origin`,
	'repositories:workstream-merge-conflicted': (payload) => {
		const paths = Array.isArray(payload['conflictedPaths']) ? payload['conflictedPaths'].length : 0;
		return `Merge stopped on conflicts in ${paths} ${paths === 1 ? 'file' : 'files'}`;
	},
	'repositories:workstream-created': () => 'Workstream started',
	'repositories:workstream-removed': (payload) =>
		payload['archived'] === true ? 'Workstream archived' : 'Workstream removed',
	'repositories:workstream-files-changed': (payload) => {
		const paths = Array.isArray(payload['paths']) ? payload['paths'].length : null;
		return paths === null ? 'Files changed' : `${paths} ${paths === 1 ? 'file' : 'files'} changed`;
	},
	'pull-requests:ship-changed': (payload) =>
		payload['merged'] ? 'Pull request merged' : 'Shipping state changed',
	'pull-requests:local-base-synced': () => 'Local base branch synced',
	'jobs:run-changed': (payload) => {
		const run = record(payload['run']);
		return `${text(run['title']) ?? 'A job'} is ${text(run['status']) ?? 'changed'}`;
	},
	'jobs:agent-action-changed': (payload) => {
		const action = record(payload['action']);
		return `Called ${text(action['tool']) ?? 'a Malini tool'}`;
	},
	'app:updated': () => 'Malini updated',
};

export function timelineTitle(item: TimelineItem): string {
	switch (item.kind) {
		case 'event':
			return eventTitle(item.event);
		case 'run':
			return item.run.requests > 1
				? `${item.run.title}, asked ${item.run.requests} times`
				: item.run.title;
		case 'turn':
			return item.turn.prompt || item.turn.chatName;
		case 'decision':
			return item.decision.candidates[item.decision.chosen]?.kind === 'ask-you'
				? decisionQuestion(item.decision)
				: decisionAction(item.decision);
	}
}

export function timelineStatus(item: TimelineItem): string {
	switch (item.kind) {
		case 'event':
			return item.event.channel;
		case 'run':
			return JOB_RUN_STATUS[item.run.status].label;
		case 'turn':
			return JOB_RUN_STATUS[item.turn.status].label;
		case 'decision':
			return DECISION_STATUS[item.decision.status].label;
	}
}

export function timelineTone(item: TimelineItem): TimelineTone {
	switch (item.kind) {
		case 'event':
			return eventTone(item.event);
		case 'run':
			return statusTone(item.run.status);
		case 'turn':
			return statusTone(item.turn.status);
		case 'decision':
			return statusTone(item.decision.status);
	}
}

export function timelineClock(at: number): string {
	return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function eventTitle(event: LoggedEventRecord): string {
	const title = EVENT_TITLES[event.channel];
	return title ? title(record(event.payload)) : event.channel;
}

function eventTone(event: LoggedEventRecord): TimelineTone {
	const payload = record(event.payload);
	if (event.channel === 'repositories:workstream-merge-conflicted') return 'failed';
	if (event.channel === 'chat:turn-finished') {
		if (payload['status'] === 'failed') return 'failed';
		if (text(payload['needs'])) return 'needs';
		return 'done';
	}
	return 'idle';
}

function statusTone(status: string): TimelineTone {
	if (status === 'succeeded' || status === 'done') return 'done';
	if (status === 'failed') return 'failed';
	if (status === 'needs-you' || status === 'waiting' || status === 'asking') return 'needs';
	if (status === 'running' || status === 'queued' || status === 'pending') return 'running';
	return 'idle';
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
