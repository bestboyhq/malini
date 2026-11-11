import type { SessionStatus } from '$contract/agent-state-machine';

export type SessionId = string;

export type AgentSession = {
	id: SessionId;
	workstreamId: string;
	provider: string;
	model: string | null;
	status: SessionStatus;
};
