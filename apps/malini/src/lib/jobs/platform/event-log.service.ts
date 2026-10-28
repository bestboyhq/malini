import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { EVENT_CATALOG } from '$contract/event-catalog';
import {
	CHAT_RUN_CHANGES_CAPTURED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_RUN_STARTED_CHANNEL,
	JOBS_TIME_REACHED_CHANNEL,
	JOBS_TOOL_CALLED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
	REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL,
	isEventChannel,
	type EventChannel,
} from '$contract/events';
import type { EventCause } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	chatTurnChainId,
	chatTurnSessionId,
	getRunWorkstreamId,
	workChatTurnInWorkstream,
} from '$lib/chat/chat.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import {
	eventChainId,
	getLoggedEvent,
	insertLoggedEvent,
	latestLoggedEvent,
	listUnhandledEvents,
	markEventHandled,
	pruneEventLog,
} from './event-log.repository';
import {
	findActiveJobRunForSession,
	getJobRun,
	jobRunChainId,
	workJobRunInWorkstream,
} from './job-runs.repository';

export const EVENT_LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1_000;

const REPLAY_WINDOW_MS = 60 * 60 * 1_000;

const STORED_PAYLOAD_MAX_BYTES = 64 * 1024;

// ponytail: work that ended in the last 5 s still owns a change, covering the watcher's 2 s wait; record when a burst of changes began if a person edits right after a turn ends
const WORK_GRACE_MS = 5_000;

const SETUP_CHANNELS: ReadonlySet<EventChannel> = new Set([
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL,
	REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
]);

const YOUR_CHANNELS: ReadonlySet<EventChannel> = new Set([
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
]);

const SHIPPING_CHANNELS: ReadonlySet<EventChannel> = new Set([
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	JOBS_TIME_REACHED_CHANNEL,
]);

const RUN_CHANNELS: ReadonlySet<EventChannel> = new Set([
	JOBS_RUN_STARTED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
]);

const ANY_TIME = new Date(0).toISOString();

export type DispatchedEvent = Readonly<{
	id: number | null;
	channel: EventChannel;
	payload: unknown;
	chainId: string | null;
	cause: EventCause | null;
}>;

export type EventHandler = (event: DispatchedEvent) => Promise<void>;

type Handling = { readonly id: number; open: boolean };

const handling = new AsyncLocalStorage<Handling>();

export async function withHandledEvent<T>(
	event: DispatchedEvent,
	work: () => Promise<T>,
): Promise<T> {
	if (event.id === null) return outsideHandledEvents(work);
	const scope: Handling = { id: event.id, open: true };
	try {
		return await handling.run(scope, work);
	} finally {
		scope.open = false;
	}
}

export function outsideHandledEvents<T>(work: () => T): T {
	return handling.exit(work);
}

export function handledEvent(): number | null {
	const scope = handling.getStore();
	return scope?.open === true ? scope.id : null;
}

export function isLoggedChannel(channel: EventChannel): boolean {
	return EVENT_CATALOG[channel].logged !== false;
}

export function startEventLog(
	context: MainContext,
	log: (line: string) => void,
	handle: EventHandler,
): { dispose(): void } {
	const { db, events } = context;

	const handleAndMark = async (event: DispatchedEvent): Promise<void> => {
		try {
			await withHandledEvent(event, () => handle(event));
		} catch (error) {
			log(`jobs: could not handle ${event.channel}: ${describeError(error)}`);
		}
		if (event.id === null) return;
		try {
			markEventHandled(db, event.id, nowIso8601());
		} catch (error) {
			log(`jobs: could not mark ${event.channel} handled: ${describeError(error)}`);
		}
	};

	const dispatch = (event: DispatchedEvent): void => {
		void handleAndMark(event);
	};

	const replay = (): void => {
		try {
			const since = new Date(Date.now() - REPLAY_WINDOW_MS).toISOString();
			for (const event of listUnhandledEvents(db, since)) {
				if (isEventChannel(event.channel)) dispatch({ ...event, channel: event.channel });
				else markEventHandled(db, event.id, nowIso8601());
			}
		} catch (error) {
			log(`jobs: could not replay the event log: ${describeError(error)}`);
		}
	};

	const stopObserving = events.observe((channel, payload) => {
		if (!isLoggedChannel(channel)) {
			dispatch({ id: null, channel, payload, chainId: null, cause: null });
			return;
		}
		let logged: DispatchedEvent;
		try {
			logged = record(db, channel, payload);
		} catch (error) {
			log(`jobs: could not log ${channel}: ${describeError(error)}`);
			logged = { id: null, channel, payload, chainId: null, cause: null };
		}
		dispatch(logged);
	});

	replay();

	return { dispose: stopObserving };
}

export function pruneEvents(db: MaliniDatabase, now = Date.now()): void {
	pruneEventLog(db, new Date(now - EVENT_LOG_KEEP_MS).toISOString());
}

function record(db: MaliniDatabase, channel: EventChannel, payload: unknown): DispatchedEvent {
	const emittedAt = nowIso8601();
	const named = findString(payload, 'workstreamId');
	const cause = causeOf(db, channel, payload, named, emittedAt);
	const chainId = (cause === null ? null : chainOf(db, cause)) ?? randomUUID();
	const text = JSON.stringify(payload) ?? 'null';
	const id = insertLoggedEvent(db, {
		channel,
		payload: Buffer.byteLength(text, 'utf8') > STORED_PAYLOAD_MAX_BYTES ? 'null' : text,
		workstreamId: named ?? (cause === null ? null : workstreamOf(db, cause)),
		cause,
		chainId,
		emittedAt,
	});
	return { id, channel, payload, chainId, cause };
}

function causeOf(
	db: MaliniDatabase,
	channel: EventChannel,
	payload: unknown,
	workstreamId: string | null,
	emittedAt: string,
): EventCause | null {
	if (RUN_CHANNELS.has(channel)) {
		const runId = findString(isRecord(payload) ? payload['run'] : null, 'id');
		return runId === null ? null : { kind: 'job-run', id: runId };
	}
	if (channel === JOBS_TOOL_CALLED_CHANNEL) {
		const action = isRecord(payload) ? payload['action'] : null;
		return turnCause(db, findString(action, 'sessionId'), findString(action, 'runId'));
	}
	if (
		channel === CHAT_TURN_FINISHED_CHANNEL ||
		channel === CHAT_RUN_CHANGES_CAPTURED_CHANNEL ||
		(channel === JOBS_TIME_REACHED_CHANNEL && findString(payload, 'wait') === 'resume')
	) {
		return turnCause(db, findString(payload, 'sessionId'), findString(payload, 'runId'));
	}
	if (YOUR_CHANNELS.has(channel)) return null;
	const alarmCause = channel === JOBS_TIME_REACHED_CHANNEL ? setBy(payload) : null;
	if (alarmCause !== null) return { kind: 'event', id: String(alarmCause) };
	const handled = handledEvent();
	if (handled !== null) return { kind: 'event', id: String(handled) };
	if (workstreamId !== null && SHIPPING_CHANNELS.has(channel)) {
		return shippingWork(db, workstreamId);
	}
	const since = new Date(Date.parse(emittedAt) - WORK_GRACE_MS).toISOString();
	return (
		(workstreamId === null ? null : workIn(db, workstreamId, since)) ??
		(SETUP_CHANNELS.has(channel) ? starterWork(db, payload, since) : null)
	);
}

function setBy(payload: unknown): number | null {
	const id = isRecord(payload) ? payload['causeEventId'] : null;
	return typeof id === 'number' && Number.isInteger(id) ? id : null;
}

function shippingWork(db: MaliniDatabase, workstreamId: string): EventCause | null {
	const click = latestLoggedEvent(db, PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, workstreamId);
	if (click === null) return workIn(db, workstreamId, ANY_TIME);
	return workIn(db, workstreamId, click.emittedAt) ?? { kind: 'event', id: String(click.id) };
}

function turnCause(
	db: MaliniDatabase,
	sessionId: string | null,
	runId: string | null,
): EventCause | null {
	const session = sessionId ?? (runId === null ? null : chatTurnSessionId(db, runId));
	const jobRun = session === null ? null : findActiveJobRunForSession(db, session);
	if (jobRun) return { kind: 'job-run', id: jobRun.id };
	return runId === null ? null : { kind: 'chat-turn', id: runId };
}

function workIn(db: MaliniDatabase, workstreamId: string, since: string): EventCause | null {
	const jobRun = workJobRunInWorkstream(db, workstreamId, since);
	if (jobRun && (jobRun.status === 'running' || jobRun.status === 'needs-you')) {
		return { kind: 'job-run', id: jobRun.id };
	}
	const turn = workChatTurnInWorkstream(db, workstreamId, since);
	if (jobRun && (!turn || turn.sessionId === jobRun.sessionId)) {
		return { kind: 'job-run', id: jobRun.id };
	}
	return turn ? { kind: 'chat-turn', id: turn.runId } : null;
}

function starterWork(db: MaliniDatabase, payload: unknown, since: string): EventCause | null {
	const workstream = isRecord(payload) ? payload['workstream'] : null;
	const startedBy =
		findString(workstream, 'startedBy') ??
		getWorkstream(db, findString(payload, 'workstreamId') ?? '')?.startedBy ??
		null;
	return startedBy === null ? null : workIn(db, startedBy, since);
}

function chainOf(db: MaliniDatabase, cause: EventCause): string | null {
	switch (cause.kind) {
		case 'job-run':
			return jobRunChainId(db, cause.id);
		case 'chat-turn':
			return chatTurnChainId(db, cause.id);
		case 'event':
			return eventChainId(db, Number(cause.id));
	}
}

function workstreamOf(db: MaliniDatabase, cause: EventCause): string | null {
	switch (cause.kind) {
		case 'job-run':
			return getJobRun(db, cause.id)?.workstreamId ?? null;
		case 'chat-turn':
			return getRunWorkstreamId(db, cause.id);
		case 'event':
			return getLoggedEvent(db, Number(cause.id))?.workstreamId ?? null;
	}
}

export function findString(payload: unknown, key: string): string | null {
	if (!isRecord(payload)) return null;
	const own = payload[key];
	if (typeof own === 'string' && own.length > 0) return own;
	for (const child of Object.values(payload)) {
		const nested = isRecord(child) ? child[key] : undefined;
		if (typeof nested === 'string' && nested.length > 0) return nested;
	}
	return null;
}
