import type { DockerOwnership, OwnedContainer } from '$main/docker/ownership';
import type { ContainerReclaim } from '$main/docker/reclaim';
import type { CheckoutResolver } from './platform/checkout-resolver';
import type { GhRunner } from './platform/github.service';
import type { WorkstreamFileResolver } from './platform/image-protocol';
import type { InstallOutcome, InstallRegistry } from './platform/provisioning.service';
import type { WorkstreamWatchers } from './platform/watcher';

export interface RepositoriesPlatform {
	readonly checkouts: CheckoutResolver;
	readonly media: WorkstreamFileResolver;
	readonly ownership: DockerOwnership;
	readonly installs: InstallRegistry;
	readonly watchers: WorkstreamWatchers;
	readonly bundleIdentifier: string;
	readonly appInstanceId: string;
	containerCount(): number;
	listOwnedContainers(): Promise<OwnedContainer[]>;
	readCheckout<T>(workstreamId: string, read: (worktree: string) => Promise<T>): Promise<T>;
	provisionDependencies(workstreamId: string): Promise<InstallOutcome>;
	abortInstall(workstreamId: string): Promise<void>;
	cancelGitHubSignIn(): void;
	readonly gh: GhRunner;
	listLiveWorkstreamIds(): string[];
	reclaimAbandonedContainers(budgetMs?: number): Promise<ContainerReclaim>;
}

export type { CheckoutResolver };
export type { InstallOutcome, InstallRegistry };
export type { TeardownGuard } from './platform/teardown.service';
export {
	deleteWorkstreamSnapshotRefs,
	restoreStrandedCheckouts,
} from './platform/teardown.service';
export {
	UNKNOWN_WORKSTREAM,
	UNKNOWN_WORKSTREAM_REPOSITORY,
	UNRESOLVABLE_WORKSTREAM_CHECKOUT,
	WORKSTREAM_CHECKOUT_NOT_A_DIRECTORY,
	createCheckoutResolver,
} from './platform/checkout-resolver';
export {
	claimAlreadyPushedRunThreadResolution,
	claimCommitRunThreadResolution,
	commitRunConsumed,
} from './platform/commit-runs.repository';
export { getProject, listProjects, upsertProject } from './platform/projects.repository';
export {
	deleteWorkstream,
	getWorkstream,
	listArchivedWorkstreams,
	listWorkstreams,
	recordMergedPullRequest,
	renameWorkstream,
	workstreamAwaitsName,
	upsertWorkstream,
	upsertWorkstreamBundle,
} from './platform/workstreams.repository';
export {
	deleteConnectedRepository,
	findConnectedRepositoryByFullName,
	getConnectedRepository,
	listConnectedRepositories,
	upsertConnectedRepository,
	type ConnectedRepository,
} from './platform/connected-repositories.repository';
export {
	LOCAL_REPOSITORY_ID_PREFIX,
	githubFullNameFromRemote,
	managedProjectIdForRepository,
	readDefaultBranch,
	readOrigin,
	resolveConnectedRepository,
	resolveRepositoryCheckout,
} from './platform/repository.service';
export {
	automatedPullRequestMetadata,
	type AutomatedPullRequestMetadata,
	type PullRequestAutomationContext,
	type PullRequestAutomationEvent,
} from './domain/pull-request-metadata';
export { listRepositoryCatalog, type CatalogRepository } from './platform/repository-catalog';
export { workstreamLineage } from './platform/lineage.service';
export {
	clonePlannedRepository,
	createPlannedWorkstream,
	planRepositoryWorkstream,
	prepareStartedWorkstream,
} from './platform/workstream-start.service';
export { displayWorkstreamName } from './domain/workstream-names';
export { workstreamLeads } from './domain/workstream-leads';
export { nextWorkstreamId } from './domain/project-identity';
export { leadScopeKey, parseLeadScope, type LeadScope } from './domain/lead-scope';
export {
	projectIdentityIdsForRepository,
	repositoryName,
	repositoryOwner,
} from './domain/repository-context';
