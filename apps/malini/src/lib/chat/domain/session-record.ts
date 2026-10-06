import type { SessionStatus } from '$contract/agent-state-machine';
import type { RunId } from './run';
import type { SessionId } from './session';

export type SessionState = SessionStatus;
export type SessionStatusFilter = SessionState;

export type SessionRecord = {
	id: SessionId;
	workstreamId: string;
	displayName: string;
	model: string | null;
	status: SessionState;
	currentRunId: RunId | null;
	lastError: string | null;
	startedAt: string;
};

export function sessionStateFromReported(value: string): SessionState {
	if (
		value === 'running' ||
		value === 'waiting_for_approval' ||
		value === 'completed' ||
		value === 'failed'
	) {
		return value;
	}
	return 'idle';
}
