import type { LeadScope } from './lead-scope';
import type { WorkstreamCreationContext } from './workstream-creation-context';

export type WorkstreamId = string;

export type WorkstreamStatus = 'active' | 'paused' | 'merged' | 'archived';

export type WorkstreamCheckoutState =
	'healthy' | 'path-diverged' | 'missing' | 'not-a-checkout' | 'unresolvable' | 'unobserved';

export const UNOBSERVED_WORKSTREAM_CHECKOUT = {
	checkoutState: 'unobserved',
	checkoutIssue: null,
	resolvedPath: null,
} as const satisfies Pick<Workstream, 'checkoutState' | 'checkoutIssue' | 'resolvedPath'>;

export type Workstream = {
	id: WorkstreamId;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: WorkstreamStatus;
	createdAt: string;
	checkoutState: WorkstreamCheckoutState;
	checkoutIssue: string | null;
	resolvedPath: string | null;
	scope: LeadScope | null;
	startedBy: WorkstreamId | null;
};

export type MergedPullRequest = Readonly<{ number: number; url: string | null }>;

export type ArchivedWorkstream = Readonly<{
	id: WorkstreamId;
	projectId: string;
	name: string;
	baseBranch: string;
	archivedAt: string;
	mergedPullRequest: MergedPullRequest | null;
	savedForLater: boolean;
	scope: LeadScope | null;
	startedBy: WorkstreamId | null;
}>;

export function isWorkstreamCheckoutUsable(workstream: Workstream): boolean {
	return (
		workstream.checkoutState === 'healthy' ||
		workstream.checkoutState === 'path-diverged' ||
		workstream.checkoutState === 'unobserved'
	);
}

export type CreatedWorkstream = Pick<
	Workstream,
	'id' | 'projectId' | 'name' | 'branch' | 'baseBranch' | 'createdAt'
> & {
	worktreePath: string;
};

export type WorkstreamChangeTarget = Pick<Workstream, 'id' | 'baseBranch'>;

export function workstreamFromCreated(created: CreatedWorkstream): Workstream {
	return {
		id: created.id,
		projectId: created.projectId,
		name: created.name,
		path: created.worktreePath,
		branch: created.branch,
		baseBranch: created.baseBranch,
		status: 'active',
		createdAt: created.createdAt,
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
		scope: null,
		startedBy: null,
	};
}

export type CreateWorkstreamInput = Readonly<{
	projectId: string;
	projectRepoPath: string;
	workstreamId: WorkstreamId;
	name: string;
	baseBranch: string;
	creationContext?: WorkstreamCreationContext;
}>;
