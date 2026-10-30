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

export type NamedCount = Readonly<{ name: string; count: number }>;

export type Percentiles = Readonly<{ p50: number; p90: number; max: number }>;

export type RepositoryGroup = Readonly<{ repositories: number; runs: number }>;

export type PublishedDay = Readonly<{ date: string; runs: number; agents: number }>;

export type StatsTechniques = Readonly<{
	browserRuns: number;
	subagentRuns: number;
	skillRuns: number;
	mcpRuns: number;
	webRuns: number;
}>;

export const STATS_PARTS = [
	'techniques',
	'tools',
	'models',
	'languages',
	'mcpServers',
	'skills',
] as const;

export type StatsPart = (typeof STATS_PARTS)[number];

export type SharedParts = Readonly<Record<StatsPart, boolean>>;

export type SharePartArgs = Readonly<{ part: StatsPart; on: boolean }>;

export type PublishedStats = Readonly<{
	version: 1;
	through: string;
	since: string;
	totals: Readonly<{
		runs: number;
		jobRuns: number;
		changeRuns: number;
		activeDays: number;
		toolCalls: number;
		screenshots: number;
		workstreams: number;
		mergedPullRequests: number;
		linesAdded: number;
		linesDeleted: number;
		filesChanged: number;
	}>;
	days: readonly PublishedDay[];
	intensity: Readonly<{
		agents: Readonly<{ mean: number; p50: number; p90: number; max: number }>;
		runSeconds: Percentiles;
		steps: Percentiles;
		runsPerActiveDay: Percentiles;
		linesPerChange: Readonly<{ p50: number }>;
		runsPerWorkstream: Readonly<{ p50: number }>;
	}>;
	techniques: StatsTechniques;
	models: readonly NamedCount[];
	languages: readonly NamedCount[];
	tools: readonly NamedCount[];
	mcpServers: readonly NamedCount[];
	skills: readonly NamedCount[];
	repositories: readonly NamedCount[];
	otherRepositories: Readonly<{ public: RepositoryGroup; private: RepositoryGroup }>;
}>;

export type SharedStats = Omit<PublishedStats, StatsPart> &
	Partial<Pick<PublishedStats, StatsPart>>;

export type ShareCard = Readonly<{
	stats: PublishedStats | null;
	name: string | null;
	handle: string | null;
	avatar: string | null;
}>;

export type StatsMomentKind = 'streak' | 'best-day' | 'runs';

export type StatsMoment = Readonly<{
	id: string;
	kind: StatsMomentKind;
	count: number;
	longest: boolean;
}>;

export type MomentCard = Readonly<{ moment: StatsMoment; card: ShareCard }>;

export type BestboyAccount = Readonly<{ name: string; email: string }>;

export type BestboyProfile = Readonly<{
	handle: string | null;
	public: boolean;
	url: string | null;
}>;

export type StatsPublishing = 'off' | 'on' | 'removing';

export type StatsUpload =
	| Readonly<{ state: 'idle' }>
	| Readonly<{ state: 'sending' }>
	| Readonly<{ state: 'published'; through: string }>
	| Readonly<{ state: 'no-full-day' }>
	| Readonly<{ state: 'failed'; reason: string; retrying: boolean }>;

export type ProfileState = Readonly<{
	account: BestboyAccount | null;
	profile: BestboyProfile | null;
	signingIn: boolean;
	signInNeeded: boolean;
	signInProblem: string | null;
	publishing: StatsPublishing;
	upload: StatsUpload;
	pickedRepositories: readonly string[];
	sharedParts: SharedParts;
	suggestedHandle: string | null;
}>;

export type PublishStatsArgs = Readonly<{ handle: string }>;

export type PublishStatsResult = Readonly<{ state: ProfileState; problem: string | null }>;

export type PickRepositoriesArgs = Readonly<{ repositories: readonly string[] }>;

export type PublicRepository = Readonly<{ fullName: string; runs: number }>;
