export type AgentRunChangedFile = Readonly<{
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
}>;

export type AgentRunChangeSummary = Readonly<{
	runId: string;
	beforeCommit: string;
	afterCommit: string;
	files: readonly AgentRunChangedFile[];
	capturedAt: string;
}>;

export type AgentSessionChangedFile = Readonly<{
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	runIds: readonly string[];
}>;

export type AgentSessionChanges = Readonly<{
	sessionId: string;
	runs: readonly AgentRunChangeSummary[];
	files: readonly AgentSessionChangedFile[];
	beforeCommit: string | null;
	afterCommit: string | null;
	capturedAt: string | null;
}>;

export type AgentSessionChangeScope = Readonly<{
	workstreamId: string;
}>;

export type AgentRunChangePatch = Readonly<{
	runId: string;
	beforeCommit: string;
	afterCommit: string;
	patch: string;
}>;

export type AgentSessionChangeTurnPatch = Readonly<{
	runId: string;
	turn: number;
	title: string | null;
	beforeCommit: string;
	afterCommit: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	patch: string;
}>;

export type AgentSessionChangePatch = Readonly<{
	sessionId: string;
	beforeCommit: string;
	afterCommit: string;
	patch: string;
	turns: readonly AgentSessionChangeTurnPatch[];
}>;
