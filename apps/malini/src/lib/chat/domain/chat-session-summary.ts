import type { SessionId } from './session';
import type { SessionState } from './session-record';

export type ChatSessionSummary = Readonly<{
	id: SessionId;
	workstreamId: string;
	displayName: string;
	model: string | null;
	status: SessionState;
	startedAt: string;
}>;
