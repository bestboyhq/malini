export type InitiativeWorkstream = Readonly<{ workstreamId: string; needs: string | null }>;

export type InitiativeDependency = Readonly<{
	id: string;
	title: string;
	done: boolean;
	workstreams: readonly InitiativeWorkstream[];
}>;

export type Initiative = Readonly<{
	id: string;
	repositoryFullName: string;
	title: string;
	dueOn: string | null;
	dependencies: readonly InitiativeDependency[];
}>;

export type CreateInitiativeArgs = Readonly<{
	repositoryFullName: string;
	title: string;
	dueOn: string | null;
}>;

export type UpdateInitiativeArgs = Readonly<{ id: string; title?: string; dueOn?: string | null }>;

export type InitiativeIdArgs = Readonly<{ id: string }>;

export type AddInitiativeDependencyArgs = Readonly<{ initiativeId: string; title: string }>;

export type UpdateInitiativeDependencyArgs = Readonly<{
	id: string;
	title?: string;
	done?: boolean;
}>;

export type LinkInitiativeWorkstreamArgs = Readonly<{ dependencyId: string; workstreamId: string }>;

export const INITIATIVE_TITLE_MAX_LENGTH = 300;
