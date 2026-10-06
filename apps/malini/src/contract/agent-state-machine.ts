export type SessionStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';

export type LifecycleEventKind =
	| 'run.started'
	| 'approval.requested'
	| 'question.requested'
	| 'run.completed'
	| 'run.failed'
	| 'checkpoint.restored';

export const LIFECYCLE_KINDS: readonly LifecycleEventKind[] = [
	'run.started',
	'approval.requested',
	'question.requested',
	'run.completed',
	'run.failed',
	'checkpoint.restored',
];

const LIFECYCLE_KIND_SET: ReadonlySet<string> = new Set(LIFECYCLE_KINDS);

export function isLifecycleKind(kind: string): kind is LifecycleEventKind {
	return LIFECYCLE_KIND_SET.has(kind);
}

export interface LifecycleEnvelope {
	readonly runId: string;
	readonly event: {
		readonly type: string;
		readonly error?: unknown;
	};
}

export interface SessionStatusFold {
	status: SessionStatus;
	currentRunId: string | null;
	lastError: string | null;
	terminatedRunIds: Set<string>;
}

const TRANSITIONS: Readonly<
	Record<SessionStatus, Readonly<Partial<Record<LifecycleEventKind, SessionStatus>>>>
> = {
	idle: {
		'run.started': 'running',
		'approval.requested': 'waiting_for_approval',
		'question.requested': 'waiting_for_approval',
		'run.completed': 'completed',
		'run.failed': 'failed',
		'checkpoint.restored': 'idle',
	},
	running: {
		'approval.requested': 'waiting_for_approval',
		'question.requested': 'waiting_for_approval',
		'run.completed': 'completed',
		'run.failed': 'failed',
		'checkpoint.restored': 'idle',
	},
	waiting_for_approval: {
		'run.completed': 'completed',
		'run.failed': 'failed',
		'checkpoint.restored': 'idle',
	},
	completed: {
		'run.started': 'running',
		'run.completed': 'completed',
		'run.failed': 'failed',
		'checkpoint.restored': 'idle',
	},
	failed: {
		'run.started': 'running',
		'run.completed': 'completed',
		'run.failed': 'failed',
		'checkpoint.restored': 'idle',
	},
};

export function nextSessionStatus(
	status: SessionStatus,
	kind: LifecycleEventKind,
	error: string | null = null,
): SessionStatus | 'invalid' {
	const next = TRANSITIONS[status][kind];
	if (next === undefined) return 'invalid';
	return next === 'failed' && error !== null && isCancellationError(error) ? 'idle' : next;
}

export function isCancellationError(error: string): boolean {
	return /\bcancell?ed\b/iu.test(error);
}

function extractError(event: LifecycleEnvelope['event']): string {
	return typeof event.error === 'string' ? event.error : 'unknown';
}

function failedRun(
	event: LifecycleEnvelope['event'],
): Pick<SessionStatusFold, 'status' | 'lastError'> {
	const error = extractError(event);
	return isCancellationError(error)
		? { status: 'idle', lastError: 'cancelled' }
		: { status: 'failed', lastError: error };
}

export function foldSessionStatus(
	base: SessionStatus,
	envelopes: readonly LifecycleEnvelope[],
): SessionStatusFold {
	let status: SessionStatus = base;
	let currentRunId: string | null = null;
	let lastError: string | null = null;
	const terminatedRunIds = new Set<string>();
	for (const { runId, event } of envelopes) {
		if (!isLifecycleKind(event.type)) continue;
		if (event.type !== 'checkpoint.restored' && terminatedRunIds.has(runId)) continue;
		switch (event.type) {
			case 'run.started':
				status = 'running';
				currentRunId = runId;
				lastError = null;
				break;
			case 'approval.requested':
			case 'question.requested':
				status = 'waiting_for_approval';
				currentRunId = runId;
				break;
			case 'run.completed':
				terminatedRunIds.add(runId);
				status = 'completed';
				currentRunId = null;
				lastError = null;
				break;
			case 'run.failed':
				terminatedRunIds.add(runId);
				({ status, lastError } = failedRun(event));
				currentRunId = null;
				break;
			case 'checkpoint.restored':
				status = 'idle';
				currentRunId = null;
				lastError = null;
				break;
		}
	}
	return { status, currentRunId, lastError, terminatedRunIds };
}

export function foldSessionStatusIncremental(
	base: SessionStatusFold,
	envelopes: readonly LifecycleEnvelope[],
): SessionStatusFold | null {
	let status = base.status;
	let currentRunId = base.currentRunId;
	let lastError = base.lastError;
	let changed = false;
	for (const { runId, event } of envelopes) {
		if (!isLifecycleKind(event.type)) continue;
		if (event.type !== 'checkpoint.restored' && base.terminatedRunIds.has(runId)) continue;
		switch (event.type) {
			case 'run.started':
				status = 'running';
				currentRunId = runId;
				lastError = null;
				changed = true;
				break;
			case 'approval.requested':
			case 'question.requested':
				status = 'waiting_for_approval';
				currentRunId = runId;
				changed = true;
				break;
			case 'run.completed':
				base.terminatedRunIds.add(runId);
				status = 'completed';
				currentRunId = null;
				lastError = null;
				changed = true;
				break;
			case 'run.failed':
				base.terminatedRunIds.add(runId);
				({ status, lastError } = failedRun(event));
				currentRunId = null;
				changed = true;
				break;
			case 'checkpoint.restored':
				status = 'idle';
				currentRunId = null;
				lastError = null;
				changed = true;
				break;
		}
	}
	if (!changed) return null;
	return { status, currentRunId, lastError, terminatedRunIds: base.terminatedRunIds };
}
