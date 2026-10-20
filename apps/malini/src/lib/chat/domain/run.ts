import type { SessionId } from './session';

export type RunId = string;

export type AgentRun = {
	id: RunId;
	sessionId: SessionId;
	prompt: string;
	startedAt: string;
	completedAt: string | null;
	summary: string | null;
};
