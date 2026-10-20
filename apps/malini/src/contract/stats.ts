export type ResourceKind = 'malini' | 'browser' | 'agents' | 'tools' | 'docker';

export type ResourceUsage = Readonly<{
	kind: ResourceKind;
	memoryBytes: number;
	cpuPercent: number;
	processes: number;
}>;

export type ResourceSample = Readonly<{
	sampledAt: number;
	memoryBytes: number;
	cpuPercent: number;
	processes: number;
	usage: readonly ResourceUsage[];
}>;

export type ResourceItem = Readonly<{
	label: string;
	workstream: string | null;
	memoryBytes: number;
}>;

export type ResourceKindBreakdown = Readonly<{
	kind: ResourceKind;
	items: readonly ResourceItem[];
	unlisted: number;
	unlistedMemoryBytes: number;
}>;

export type ResourceHistory = Readonly<{
	machineMemoryBytes: number;
	samples: readonly ResourceSample[];
}>;

export type ActivityDay = Readonly<{ date: string; runs: number }>;

export type RepositoryActivity = Readonly<{ fullName: string; runs: number }>;

export type ActivityStats = Readonly<{
	today: string;
	runs: number;
	jobRuns: number;
	agentSeconds: number;
	runningAgents: number;
	days: readonly ActivityDay[];
	repositories: readonly RepositoryActivity[];
}>;

export type RunningItemOrigin = 'agent' | 'docker';

export type RunningItemKind = 'service' | 'task';

export type RunningItem = Readonly<{
	id: string;
	origin: RunningItemOrigin;
	name: string;
	kind: RunningItemKind;
	detail: string;
	group: string | null;
	startedAt: number;
	ports: readonly number[];
}>;

export type WorkstreamTurn = Readonly<{
	endedAt: number;
	outcome: string | null;
	need: string | null;
}>;

export type WorkstreamRunning = Readonly<{
	workstreamId: string;
	items: readonly RunningItem[];
	behind: readonly string[];
	turn: WorkstreamTurn | null;
}>;

export type StopRunningArgs = Readonly<{
	workstreamId: string;
	itemIds: readonly string[];
}>;
