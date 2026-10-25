import { LEAD_SPACE_BRANCH, LEAD_SPACE_PROJECT_ID, type LeadScope } from './lead-scope';
import {
	nextWorkstreamId,
	projectIdentityCandidatesForRepoUrl,
	projectIdentityForRepoUrl,
	workstreamBranch,
} from './project-identity';
import type { Project, Repository } from './repository';
import { repositoryCloneSource } from './repository-context';
import { UNOBSERVED_WORKSTREAM_CHECKOUT, type Workstream, type WorkstreamId } from './workstream';
import { uniqueWorkstreamName } from './workstream-names';

export const WORKSTREAM_PROVISIONING_PHASES = [
	'preparing',
	'cloning',
	'worktree',
	'syncing',
] as const;

export type WorkstreamProvisioningPhase = (typeof WORKSTREAM_PROVISIONING_PHASES)[number];

type PlannedCheckout = Readonly<{
	workstreamId: WorkstreamId;
	projectId: string;
	name: string;
	branch: string;
	baseBranch: string;
}>;

export type RepositoryWorkstreamPlan = PlannedCheckout &
	Readonly<{
		scope: null;
		projectRepoPath: string | null;
		cloneProgressId: string;
		repoUrl: string;
		repositoryFullName: string;
	}>;

export type LeadChatPlan = PlannedCheckout & Readonly<{ scope: LeadScope }>;

export type WorkstreamProvisioningPlan = RepositoryWorkstreamPlan | LeadChatPlan;

export type WorkstreamSetupOutcome = Readonly<{
	workstreamId: string;
	status: 'ready' | 'abandoned';
}>;

export type WorkstreamProvisioningRecord = Readonly<{
	plan: WorkstreamProvisioningPlan;
	phase: WorkstreamProvisioningPhase;
	clonePercent: number | null;
	failure: string | null;
	startedAt: number;
}>;

export const WORKSTREAM_INSTALL_STATUS_EVENT = 'repositories:workstream-install-status';

export type WorkstreamInstallStatus = 'running' | 'unavailable' | 'failed';

export type WorkstreamInstallRecord = Readonly<{
	workstreamId: string;
	status: WorkstreamInstallStatus;
	command: string | null;
	detail: string | null;
	noticeAt: number;
}>;

export const QUIET_INSTALL_START_MS = 3_000;

export function installNoticeAt(
	previous: WorkstreamInstallRecord | null,
	status: WorkstreamInstallStatus,
	now: number,
): number {
	if (status !== 'running') return now;
	if (previous?.status === 'running') return previous.noticeAt;
	return previous ? now : now + QUIET_INSTALL_START_MS;
}

export type WorkstreamInstallStatusEvent = Readonly<{
	workstreamId?: unknown;
	status?: unknown;
	command?: unknown;
	reason?: unknown;
	detail?: unknown;
}>;

export function visibleInstallStatus(
	event: WorkstreamInstallStatusEvent,
): WorkstreamInstallStatus | null {
	if (event.status === 'running') return 'running';
	if (event.status === 'failed') return 'failed';
	if (event.status === 'skipped' && event.reason === 'unrecognized-project') return 'unavailable';
	return null;
}

export function provisioningClonePercent(fraction: number): number {
	if (!Number.isFinite(fraction) || fraction <= 0) return 0;
	if (fraction >= 1) return 100;
	return Math.round(fraction * 100);
}

export type WorkstreamNativeExistence = 'platform' | 'absent' | 'in-flight';

export function workstreamNativeExistence(
	record: WorkstreamProvisioningRecord | null,
): WorkstreamNativeExistence {
	if (!record || record.phase === 'syncing') return 'platform';
	return record.failure ? 'absent' : 'in-flight';
}

const PROVISIONING_STEP_LABELS: Readonly<
	Record<WorkstreamProvisioningPhase, (plan: WorkstreamProvisioningPlan) => string>
> = {
	preparing: () => 'Preparing workstream',
	cloning: (plan) => (plan.scope === null ? `Cloning ${plan.repositoryFullName}` : 'Cloning'),
	worktree: () => 'Creating worktree',
	syncing: (plan) => `Updating ${plan.baseBranch} from origin`,
};

export function provisioningStepLabel(record: WorkstreamProvisioningRecord): string {
	return PROVISIONING_STEP_LABELS[record.phase](record.plan);
}

export function planWorkstreamProvisioning(input: {
	repo: Pick<Repository, 'fullName' | 'defaultBranch' | 'remoteUrl' | 'localPath'>;
	projects: readonly Project[];
	workstreamId?: WorkstreamId;
	takenNames?: readonly string[];
}): RepositoryWorkstreamPlan {
	const repoUrl = repositoryCloneSource(input.repo);
	const identity = projectIdentityForRepoUrl(repoUrl);
	const candidateIds = new Set(
		projectIdentityCandidatesForRepoUrl(repoUrl).map((candidate) => candidate.id),
	);
	const existingProject = input.projects.find((project) => candidateIds.has(project.id)) ?? null;
	const workstreamId = input.workstreamId ?? nextWorkstreamId();
	return {
		workstreamId,
		projectId: existingProject?.id ?? identity.id,
		projectRepoPath: existingProject?.repoPath ?? null,
		cloneProgressId: identity.name,
		repoUrl,
		repositoryFullName: input.repo.fullName,
		name: uniqueWorkstreamName(workstreamId, input.takenNames ?? []),
		branch: workstreamBranch(workstreamId),
		baseBranch: input.repo.defaultBranch,
		scope: null,
	};
}

export function planLeadChatProvisioning(
	scope: LeadScope,
	takenNames: readonly string[],
): LeadChatPlan {
	const workstreamId = nextWorkstreamId();
	return {
		workstreamId,
		projectId: LEAD_SPACE_PROJECT_ID,
		name: uniqueWorkstreamName(workstreamId, takenNames),
		branch: workstreamBranch(workstreamId),
		baseBranch: LEAD_SPACE_BRANCH,
		scope,
	};
}

export function provisioningWorkstreamRow(
	plan: WorkstreamProvisioningPlan,
	createdAt: string,
): Workstream {
	return {
		id: plan.workstreamId,
		projectId: plan.projectId,
		name: plan.name,
		path: '',
		branch: plan.branch,
		baseBranch: plan.baseBranch,
		status: 'active',
		createdAt,
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
		scope: plan.scope,
		startedBy: null,
	};
}

export function provisioningFailureMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (typeof cause === 'string' && cause.trim()) return cause;
	return 'Workstream setup failed';
}

export function provisioningFailureIsAuth(failure: string): boolean {
	const normalized = failure.toLocaleLowerCase();
	return (
		normalized.includes('auth failed') ||
		normalized.includes('authentication failed') ||
		normalized.includes('could not read username') ||
		normalized.includes('gh auth login') ||
		normalized.includes('sign in to github')
	);
}
