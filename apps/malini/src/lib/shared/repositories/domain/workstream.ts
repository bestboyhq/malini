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
	checkoutState: WorkstreamCheckoutState;
	checkoutIssue: string | null;
	resolvedPath: string | null;
};

export function isWorkstreamCheckoutUsable(workstream: Workstream): boolean {
	return (
		workstream.checkoutState === 'healthy' ||
		workstream.checkoutState === 'path-diverged' ||
		workstream.checkoutState === 'unobserved'
	);
}

export type CreatedWorkstream = Pick<
	Workstream,
	'id' | 'projectId' | 'name' | 'branch' | 'baseBranch'
> & {
	worktreePath: string;
};

export type WorkstreamCheckpoint = {
	sha: string;
	message: string;
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
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
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
