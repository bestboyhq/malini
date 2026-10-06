import type { SessionStatus } from './events';

export type SessionId = string;

export type AgentSession = {
	id: SessionId;
	workstreamId: string;
	model: string | null;
	status: SessionStatus;
};
