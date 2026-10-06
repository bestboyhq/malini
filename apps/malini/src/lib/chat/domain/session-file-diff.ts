export type AgentSessionFileNetDiff = Readonly<{
	beforeCommit: string;
	afterCommit: string;
	capturedAt: string;
	patch: string;
}>;

export type AgentSessionFileTurnDiff = Readonly<{
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

export type AgentSessionFileDiffRequest = Readonly<{
	sessionId: string;
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	contributingRunIds: readonly string[];
	net: AgentSessionFileNetDiff;
	turns: readonly AgentSessionFileTurnDiff[];
}>;

export type AgentSessionFileDiffTarget = Readonly<{
	open(
		workstreamId: string,
		request: AgentSessionFileDiffRequest,
		signal: AbortSignal,
	): Promise<void>;
}>;
