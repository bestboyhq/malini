import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
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
	REPOSITORIES_WORKSTREAM_CREATED_CHANNEL,
	REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
	REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL,
	isEventChannel,
	type EventChannel,
} from '$contract/events';
import type { EventCause } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { canonicalJson, isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	chatTurnChainId,
	chatTurnSessionId,
	getRunWorkstreamId,
	workChatTurnInWorkstream,
} from '$lib/chat/chat.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import {
	insertLoggedEvent,
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

const SHIPPING_CHANNELS: ReadonlySet<EventChannel> = new Set([
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
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
	digest: string | null;
	chainId: string | null;
	cause: EventCause | null;
}>;

export type EventHandler = (event: DispatchedEvent) => Promise<void>;

export function isLoggedChannel(channel: EventChannel): boolean {
	return EVENT_CATALOG[channel].logged !== false;
}

export function eventDigest(payload: unknown): string {
	return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function startEventLog(
	context: MainContext,
	log: (line: string) => void,
	handle: EventHandler,
): { dispose(): void } {
	const { db, events } = context;

	const handleAndMark = async (event: DispatchedEvent): Promise<void> => {
		try {
			await handle(event);
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
			dispatch({ id: null, channel, payload, digest: null, chainId: null, cause: null });
			return;
		}
		const digest = eventDigest(payload);
		let logged: DispatchedEvent;
		try {
			logged = record(db, channel, payload, digest);
		} catch (error) {
			log(`jobs: could not log ${channel}: ${describeError(error)}`);
			logged = { id: null, channel, payload, digest, chainId: null, cause: null };
		}
		dispatch(logged);
	});

	replay();

	return { dispose: stopObserving };
}

export function pruneEvents(db: MaliniDatabase, now = Date.now()): void {
	pruneEventLog(db, new Date(now - EVENT_LOG_KEEP_MS).toISOString());
}

function record(
	db: MaliniDatabase,
	channel: EventChannel,
	payload: unknown,
	digest: string,
): DispatchedEvent {
	const emittedAt = nowIso8601();
	const named = findString(payload, 'workstreamId');
	const cause = causeOf(db, channel, payload, named, emittedAt);
	const chainId = (cause === null ? null : chainOf(db, cause)) ?? randomUUID();
	const text = JSON.stringify(payload) ?? 'null';
	const id = insertLoggedEvent(db, {
		channel,
		payload: Buffer.byteLength(text, 'utf8') > STORED_PAYLOAD_MAX_BYTES ? 'null' : text,
		digest,
		workstreamId: named ?? (cause === null ? null : workstreamOf(db, cause)),
		cause,
		chainId,
		emittedAt,
	});
	return { id, channel, payload, digest, chainId, cause };
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
	if (channel === CHAT_TURN_FINISHED_CHANNEL || channel === CHAT_RUN_CHANGES_CAPTURED_CHANNEL) {
		return turnCause(db, findString(payload, 'sessionId'), findString(payload, 'runId'));
	}
	const since = SHIPPING_CHANNELS.has(channel)
		? ANY_TIME
		: new Date(Date.parse(emittedAt) - WORK_GRACE_MS).toISOString();
	return (
		(workstreamId === null ? null : workIn(db, workstreamId, since)) ??
		(SETUP_CHANNELS.has(channel) ? starterWork(db, payload, since) : null)
	);
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
	return cause.kind === 'job-run' ? jobRunChainId(db, cause.id) : chatTurnChainId(db, cause.id);
}

function workstreamOf(db: MaliniDatabase, cause: EventCause): string | null {
	return cause.kind === 'job-run'
		? (getJobRun(db, cause.id)?.workstreamId ?? null)
		: getRunWorkstreamId(db, cause.id);
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
