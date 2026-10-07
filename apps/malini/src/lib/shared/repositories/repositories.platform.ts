import type { DockerOwnership, OwnedContainer } from '$main/docker/ownership';
import type { ContainerReclaim } from '$main/docker/reclaim';
import type { CheckoutResolver } from './platform/checkout-resolver';
import type { InstallOutcome, InstallRegistry } from './platform/provisioning.service';
import type { WorkstreamWatchers } from './platform/watcher';

export interface RepositoriesPlatform {
	readonly checkouts: CheckoutResolver;
	readonly ownership: DockerOwnership;
	readonly installs: InstallRegistry;
	readonly watchers: WorkstreamWatchers;
	readonly bundleIdentifier: string;
	readonly appInstanceId: string;
	containerCount(): number;
	listOwnedContainers(): Promise<OwnedContainer[]>;
	provisionDependencies(workstreamId: string): Promise<InstallOutcome>;
	abortInstall(workstreamId: string): Promise<void>;
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
	listWorkstreams,
	renameWorkstream,
	workstreamHasUserRun,
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
