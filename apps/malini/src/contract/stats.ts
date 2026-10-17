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
