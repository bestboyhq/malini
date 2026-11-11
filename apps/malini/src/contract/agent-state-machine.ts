export type SessionStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';

export const SESSION_STATUSES: readonly SessionStatus[] = [
	'idle',
	'running',
	'waiting_for_approval',
	'completed',
	'failed',
];

const SESSION_STATUS_SET: ReadonlySet<string> = new Set(SESSION_STATUSES);

export function isSessionStatus(value: unknown): value is SessionStatus {
	return typeof value === 'string' && SESSION_STATUS_SET.has(value);
}

export function isWaitingForUser(status: SessionStatus | null | undefined): boolean {
	return status === 'waiting_for_approval';
}

export function hasOpenRun(status: SessionStatus | null | undefined): boolean {
	return status === 'running' || status === 'waiting_for_approval';
}

export type LifecycleEventKind =
	| 'run.started'
	| 'approval.requested'
	| 'question.requested'
	| 'approval.decided'
	| 'question.answered'
	| 'run.completed'
	| 'run.failed'
	| 'checkpoint.restored';

export const LIFECYCLE_KINDS: readonly LifecycleEventKind[] = [
	'run.started',
	'approval.requested',
	'question.requested',
	'approval.decided',
	'question.answered',
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
		readonly resumeAt?: unknown;
		readonly approvalId?: unknown;
		readonly questionId?: unknown;
	};
}

export interface SessionStatusFold {
	status: SessionStatus;
	currentRunId: string | null;
	lastError: string | null;
	terminatedRunIds: Set<string>;
	openRequests: Set<string>;
}

export interface TransitionGuard {
	readonly error?: string | null;
	readonly paused?: boolean;
	readonly stillWaiting?: boolean;
}

export function nextSessionStatus(
	status: SessionStatus,
	kind: LifecycleEventKind,
	guard: TransitionGuard = {},
): SessionStatus {
	switch (kind) {
		case 'run.started':
			return 'running';
		case 'approval.requested':
		case 'question.requested':
			return 'waiting_for_approval';
		case 'approval.decided':
		case 'question.answered':
			return isWaitingForUser(status) && guard.stillWaiting !== true ? 'running' : status;
		case 'run.completed':
			return 'completed';
		case 'run.failed':
			return runEnding(guard.error ?? 'unknown', guard.paused === true) === 'failed'
				? 'failed'
				: 'idle';
		case 'checkpoint.restored':
			return 'idle';
	}
}

export type RunEnding = 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export const RUN_ENDINGS: readonly RunEnding[] = [
	'succeeded',
	'failed',
	'cancelled',
	'interrupted',
];

const RUN_ENDING_SET: ReadonlySet<string> = new Set(RUN_ENDINGS);

export function isRunEnding(value: unknown): value is RunEnding {
	return typeof value === 'string' && RUN_ENDING_SET.has(value);
}

export function runEnding(error: string | null, paused = false): RunEnding {
	if (paused || (error !== null && isInterruptionError(error))) return 'interrupted';
	if (error === null) return 'succeeded';
	return isCancellationError(error) ? 'cancelled' : 'failed';
}

export function isPausedRunEvent(event: Readonly<{ type?: unknown; resumeAt?: unknown }>): boolean {
	return event.type === 'run.failed' && typeof event.resumeAt === 'string';
}

export const PAUSED_FOR_EXIT_ERROR = 'paused: malini closed mid-run';

export const ORPHAN_INTERRUPTED_ERROR = 'interrupted: app closed mid-run';

export const BRIDGE_INTERRUPTED_ERROR = 'interrupted: agent bridge restarted';

export const RESET_BY_USER_ERROR = 'reset by user';

export const CONTINUE_AFTER_PAUSE_PROMPT =
	'Malini restarted while you were working and cut your last step short. Nobody rejected it: re-run whatever was interrupted and continue where you left off.';

export const CONTINUE_AFTER_STOP_PROMPT =
	"A usage limit or an error from Claude's API cut your last step short, and it is over now. Nobody rejected it: re-run whatever was interrupted and continue where you left off.";

export type ContinuationCause = 'restart' | 'outage';

const CONTINUATIONS = new Map<string, ContinuationCause>([
	[CONTINUE_AFTER_PAUSE_PROMPT.toLowerCase(), 'restart'],
	[CONTINUE_AFTER_STOP_PROMPT.toLowerCase(), 'outage'],
]);

export function continuationCause(prompt: string): ContinuationCause | null {
	return CONTINUATIONS.get(prompt.trim().toLowerCase()) ?? null;
}

export function isCancellationError(error: string): boolean {
	return /\bcancell?ed\b/iu.test(error) || error === PAUSED_FOR_EXIT_ERROR;
}

export function isInterruptionError(error: string): boolean {
	return (
		error === PAUSED_FOR_EXIT_ERROR ||
		error === ORPHAN_INTERRUPTED_ERROR ||
		error === BRIDGE_INTERRUPTED_ERROR ||
		error === RESET_BY_USER_ERROR
	);
}

function errorOf(event: LifecycleEnvelope['event']): string {
	return typeof event.error === 'string' ? event.error : 'unknown';
}

function requestKey(runId: string, event: LifecycleEnvelope['event']): string {
	return event.type.startsWith('approval.')
		? `${runId}\napproval:${String(event.approvalId)}`
		: `${runId}\nquestion:${String(event.questionId)}`;
}

function closeRequests(fold: SessionStatusFold, runId: string | null): void {
	for (const key of fold.openRequests) {
		if (runId === null || key.startsWith(`${runId}\n`)) fold.openRequests.delete(key);
	}
}

function applyLifecycle(fold: SessionStatusFold, { runId, event }: LifecycleEnvelope): boolean {
	const kind = event.type;
	if (!isLifecycleKind(kind)) return false;
	if (kind !== 'checkpoint.restored' && fold.terminatedRunIds.has(runId)) return false;
	const error = kind === 'run.failed' ? errorOf(event) : null;
	const paused = isPausedRunEvent(event);
	switch (kind) {
		case 'run.started':
			fold.currentRunId = runId;
			fold.lastError = null;
			break;
		case 'approval.requested':
		case 'question.requested':
			fold.openRequests.add(requestKey(runId, event));
			fold.currentRunId = runId;
			break;
		case 'approval.decided':
		case 'question.answered':
			fold.openRequests.delete(requestKey(runId, event));
			break;
		case 'run.completed':
		case 'run.failed': {
			fold.terminatedRunIds.add(runId);
			closeRequests(fold, runId);
			const ending = runEnding(error, paused);
			fold.currentRunId = null;
			fold.lastError = ending === 'failed' ? error : ending === 'cancelled' ? 'cancelled' : null;
			break;
		}
		case 'checkpoint.restored':
			closeRequests(fold, null);
			fold.currentRunId = null;
			fold.lastError = null;
			break;
	}
	fold.status = nextSessionStatus(fold.status, kind, {
		error,
		paused,
		stillWaiting: fold.openRequests.size > 0,
	});
	return true;
}

export function foldSessionStatus(
	base: SessionStatus,
	envelopes: readonly LifecycleEnvelope[],
): SessionStatusFold {
	const fold: SessionStatusFold = {
		status: base,
		currentRunId: null,
		lastError: null,
		terminatedRunIds: new Set(),
		openRequests: new Set(),
	};
	for (const envelope of envelopes) applyLifecycle(fold, envelope);
	return fold;
}

export function foldSessionStatusIncremental(
	base: SessionStatusFold,
	envelopes: readonly LifecycleEnvelope[],
): SessionStatusFold | null {
	const fold = { ...base };
	let changed = false;
	for (const envelope of envelopes) changed = applyLifecycle(fold, envelope) || changed;
	return changed ? fold : null;
}
