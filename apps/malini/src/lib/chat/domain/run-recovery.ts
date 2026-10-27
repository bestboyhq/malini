import type { RunFailure } from '$contract/agent';

const BACKOFF_MINUTES: readonly number[] = [1, 2, 4, 8, 15, 30];

const RESET_SLACK_MS = 5_000;

const MINUTE_MS = 60_000;

export function resumeAlarmKey(sessionId: string): string {
	return `resume:${sessionId}`;
}

export function runResumeAt(failure: RunFailure, retries: number, now: number): string | null {
	const at = resumeTime(failure, retries, now);
	return at === null ? null : new Date(at).toISOString();
}

function resumeTime(failure: RunFailure, retries: number, now: number): number | null {
	switch (failure.kind) {
		case 'usage-limit': {
			const reset = Date.parse(failure.resetsAt ?? '');
			return reset > now ? reset + RESET_SLACK_MS : backoff(retries, now);
		}
		case 'rate-limit':
		case 'overloaded':
		case 'server-error':
		case 'network':
			return backoff(retries, now);
		case 'unknown':
			return retries === 0 ? now + MINUTE_MS : null;
		case 'sign-in':
		case 'billing':
		case 'model':
		case 'request':
			return null;
	}
}

function backoff(retries: number, now: number): number | null {
	const minutes = BACKOFF_MINUTES[retries];
	return minutes === undefined ? null : now + minutes * MINUTE_MS;
}
