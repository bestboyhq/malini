export type InitiativeWorkstream = Readonly<{ workstreamId: string; needs: string | null }>;

export type InitiativeDependency = Readonly<{
	id: string;
	title: string;
	done: boolean;
	note: string | null;
	workstreams: readonly InitiativeWorkstream[];
	githubIssue: number | null;
	assignee: string | null;
}>;

export type Initiative = Readonly<{
	id: string;
	repositoryFullName: string;
	title: string;
	dueOn: string | null;
	note: string | null;
	dependencies: readonly InitiativeDependency[];
	githubMilestone: number | null;
}>;

export type CreateInitiativeArgs = Readonly<{
	repositoryFullName: string;
	title: string;
	dueOn: string | null;
}>;

export type UpdateInitiativeArgs = Readonly<{
	id: string;
	title?: string;
	dueOn?: string | null;
	note?: string | null;
}>;

export type InitiativeIdArgs = Readonly<{ id: string }>;

export type AddInitiativeDependencyArgs = Readonly<{ initiativeId: string; title: string }>;

export type UpdateInitiativeDependencyArgs = Readonly<{
	id: string;
	title?: string;
	done?: boolean;
	note?: string | null;
}>;

export type LinkInitiativeWorkstreamArgs = Readonly<{ dependencyId: string; workstreamId: string }>;

export type PlanSync = Readonly<{
	repositoryFullName: string;
	enabled: boolean;
	home: string | null;
	syncedAt: string | null;
	error: string | null;
	people: readonly string[];
}>;

export type PlanSyncArgs = Readonly<{ repositoryFullName: string }>;

export type SetPlanSyncArgs = Readonly<{ repositoryFullName: string; enabled: boolean }>;

export const PLAN_REMOTE_CHANGE_KINDS = [
	'added',
	'renamed',
	'closed',
	'reopened',
	'dated',
	'removed',
] as const;

export type PlanRemoteChangeKind = (typeof PLAN_REMOTE_CHANGE_KINDS)[number];

export type PlanRemoteChange = Readonly<{
	actor: string | null;
	kind: PlanRemoteChangeKind;
	title: string;
}>;

export type PlanSyncedEvent = Readonly<{
	repositoryFullName: string;
	changes: readonly PlanRemoteChange[];
}>;

export const INITIATIVE_TITLE_MAX_LENGTH = 300;
