export {
	UNOBSERVED_WORKSTREAM_CHECKOUT,
	isWorkstreamCheckoutUsable,
	type CreatedWorkstream,
	type Workstream,
	type WorkstreamChangeTarget,
	type WorkstreamCheckoutState,
	type WorkstreamCheckpoint,
	type WorkstreamId,
	type WorkstreamStatus,
} from './domain/workstream';

export {
	type Project,
	type ProjectId,
	type Repository,
	type RepositoryId,
} from './domain/repository';

export {
	nextWorkstreamId,
	projectIdentityCandidatesForRepoUrl,
	projectIdentityForRepoUrl,
	workstreamBranch,
	type ProjectIdentity,
} from './domain/project-identity';

export {
	GITHUB_AUTH_REQUIRED_MESSAGE,
	GitHubAuthRequiredError,
	isDuplicateRepositoryError,
	isGitHubAuthRequiredError,
	type GitHubAuthStatus,
	type RepositoryImportSource,
} from './domain/github-auth';

export {
	connectedRepositoryContexts,
	githubOwnerFromFullName,
	isGithubRemoteUrl,
	localRepositoriesFromProjects,
	mergeRepositories,
	projectIdentityIdsForRepository,
	repositoryCloneSource,
	repositoryContextForWorkstream,
	repositoryFullNameFromRemoteUrl,
	repositoryIdentityForImportSource,
	repositoryInitial,
	repositoryName,
	repositoryOwner,
	supportsRemotePullRequests,
	type ConnectedRepositoryContext,
} from './domain/repository-context';

export { displayWorkstreamName, generatedWorkstreamName } from './domain/workstream-names';

export { type WorkstreamCreationContext } from './domain/workstream-creation-context';

export { type PullRequestActivity } from './domain/workstream-freshness';

export {
	type WorkstreamChangeTotals,
	type WorkstreamSnapshot,
	type WorkstreamSnapshotReader,
	type WorkstreamSnapshotTarget,
} from './domain/workstream-snapshot';

export {
	NO_LINE_CHANGE_LABEL,
	extractChangedFiles,
	parseUnifiedDiff,
	summarizeAdditionsDeletions,
	type ChangedFile,
	type ChangedFileStatus,
	type DiffFile,
	type DiffFileNoLineChange,
	type DiffHunk,
	type DiffLine,
	type DiffLineKind,
} from './domain/diff';

export {
	WORKSTREAM_INSTALL_STATUS_EVENT,
	WORKSTREAM_PROVISIONING_PHASES,
	planWorkstreamProvisioning,
	provisioningClonePercent,
	visibleInstallStatus,
	type WorkstreamInstallRecord,
	type WorkstreamInstallStatus,
	type WorkstreamInstallStatusEvent,
	type WorkstreamProvisioningPhase,
	type WorkstreamProvisioningPlan,
	type WorkstreamProvisioningRecord,
	type WorkstreamSetupOutcome,
} from './domain/provisioning';

export {
	type AgentRunChangePatch,
	type AgentRunChangeSummary,
	type AgentRunChangedFile,
	type AgentSessionChangePatch,
	type AgentSessionChangeScope,
	type AgentSessionChangedFile,
	type AgentSessionChanges,
} from './domain/run-changes';

export { type WorkstreamGitStatus } from './domain/workstream-git-status';

export { type WorkstreamDiff } from './domain/workstream-diff';

export { workstreamCount } from './domain/workstream-retirement';

export { isCloneUrl, workstreamsForRepository } from './domain/repository-connection';

export { archiveWorkstreamCommand } from './application/commands/archive-workstream.command';
export { clearRepositoryConnectErrorCommand } from './application/commands/clear-repository-connect-error.command';
export { commitWorkstreamCheckpointCommand } from './application/commands/commit-workstream-checkpoint.command';
export { connectRepositoryCommand } from './application/commands/connect-repository.command';
export { consumeWorkstreamCreationCommand } from './application/commands/consume-workstream-creation.command';
export { createWorkstreamForRepositoryCommand } from './application/commands/create-workstream-for-repository.command';
export { deleteWorkstreamCommand } from './application/commands/delete-workstream.command';
export { dismissDependencyInstallCommand } from './application/commands/dismiss-dependency-install.command';
export { ensureWorkstreamChangeTotalsCommand } from './application/commands/ensure-workstream-change-totals.command';
export { loadGithubAuthCommand } from './application/commands/load-github-auth.command';
export { loadRepositoryAvatarCommand } from './application/commands/load-repository-avatar.command';
export { loadWorkstreamDiffCommand } from './application/commands/load-workstream-diff.command';
export { loadWorkstreamGitStatusCommand } from './application/commands/load-workstream-git-status.command';
export { openRepositoryFolderCommand } from './application/commands/open-repository-folder.command';
export { openWorkstreamInEditorCommand } from './application/commands/open-workstream-in-editor.command';
export { loadRepositoriesScopeCommand } from './application/commands/load-repositories-scope.command';
export { refreshRepositoriesCommand } from './application/commands/refresh-repositories.command';
export { refreshWorkstreamAfterChangeCommand } from './application/commands/refresh-workstream-after-change.command';
export { refreshWorkstreamChangeTotalsCommand } from './application/commands/refresh-workstream-change-totals.command';
export { refreshWorkstreamsCommand } from './application/commands/refresh-workstreams.command';
export { removeFailedWorkstreamCommand } from './application/commands/remove-failed-workstream.command';
export { removeRepositoryCommand } from './application/commands/remove-repository.command';
export { retryDependencyInstallCommand } from './application/commands/retry-dependency-install.command';
export { retryProvisioningCommand } from './application/commands/retry-provisioning.command';
export { retryRepositoriesScopeCommand } from './application/commands/retry-repositories-scope.command';
export { revealWorkstreamInFinderCommand } from './application/commands/reveal-workstream-in-finder.command';
export { trackWorkstreamChangeTotalsCommand } from './application/commands/track-workstream-change-totals.command';

export { bindExtensionNavigationHook } from './application/hooks/bind-extension-navigation.hook';
export { bindExtensionRepositoryHook } from './application/hooks/bind-extension-repository.hook';
export { followActiveWorkstreamHook } from './application/hooks/follow-active-workstream.hook';
export { followWorkstreamSetupHook } from './application/hooks/follow-workstream-setup.hook';
export { keepActiveWorkstreamFreshHook } from './application/hooks/keep-active-workstream-fresh.hook';
export { resumeProvisioningOnGithubCredentialHook } from './application/hooks/resume-provisioning-on-github-credential.hook';
export { syncWorkstreamsHook } from './application/hooks/sync-workstreams.hook';
export { trackWorkstreamChangeTotalsHook } from './application/hooks/track-workstream-change-totals.hook';
export { watchWorkstreamFilesChangedHook } from './application/hooks/watch-workstream-files-changed.hook';
export { workstreamSnapshotsHook } from './application/hooks/workstream-snapshots.hook';

export { activeWorkstreamFreshnessPhaseQuery } from './application/queries/active-workstream-freshness-phase.query.svelte';
export { activeWorkstreamsQuery } from './application/queries/active-workstreams.query.svelte';
export { changeTotalsQuery } from './application/queries/change-totals.query.svelte';
export { connectedRepositoriesQuery } from './application/queries/connected-repositories.query.svelte';
export { dependencyInstallQuery } from './application/queries/dependency-install.query.svelte';
export { githubAuthQuery } from './application/queries/github-auth.query.svelte';
export { projectsQuery } from './application/queries/projects.query.svelte';
export { provisioningRecordQuery } from './application/queries/provisioning-record.query.svelte';
export { provisioningRetryingQuery } from './application/queries/provisioning-retrying.query.svelte';
export { repositoriesScopeErrorQuery } from './application/queries/repositories-scope-error.query.svelte';
export { repositoriesScopeLoadedQuery } from './application/queries/repositories-scope-loaded.query.svelte';
export { repositoriesScopeReadyQuery } from './application/queries/repositories-scope-ready.query.svelte';
export { repositoriesScopeRetryingQuery } from './application/queries/repositories-scope-retrying.query.svelte';
export { repositoryAvatarQuery } from './application/queries/repository-avatar.query.svelte';
export { repositoryConnectErrorQuery } from './application/queries/repository-connect-error.query.svelte';
export { repositoryConnectingQuery } from './application/queries/repository-connecting.query.svelte';
export { repositoryContextQuery } from './application/queries/repository-context.query.svelte';
export { workstreamBusyActionQuery } from './application/queries/workstream-busy-action.query.svelte';
export { workstreamByIdQuery } from './application/queries/workstream-by-id.query.svelte';
export { workstreamCreationContextQuery } from './application/queries/workstream-creation-context.query.svelte';
export { workstreamCreationPendingQuery } from './application/queries/workstream-creation-pending.query.svelte';
export { workstreamDiffQuery } from './application/queries/workstream-diff.query.svelte';
export { workstreamHasChangesQuery } from './application/queries/workstream-has-changes.query.svelte';
export { workstreamNativeExistenceQuery } from './application/queries/workstream-native-existence.query.svelte';
export { workstreamProjectQuery } from './application/queries/workstream-project.query.svelte';
export { workstreamsLoadedQuery } from './application/queries/workstreams-loaded.query.svelte';
export { worktreePendingQuery } from './application/queries/worktree-pending.query.svelte';
export { checkedOutWorkstreamsQuery } from './application/queries/checked-out-workstreams.query.svelte';
export { workstreamCheckedOutQuery } from './application/queries/workstream-checked-out.query.svelte';
export { workstreamReadyForPromptsQuery } from './application/queries/workstream-ready-for-prompts.query.svelte';

export { default as RepositoryAvatar } from './presentation/RepositoryAvatar.svelte';
export { default as RepositoryListSkeleton } from './presentation/RepositoryListSkeleton.svelte';
export { default as RepositorySidebarSkeleton } from './presentation/RepositorySidebarSkeleton.svelte';
export { default as WorkstreamActionsMenu } from './presentation/WorkstreamActionsMenu.svelte';
export { default as WorkstreamProvisioningFrame } from './presentation/WorkstreamProvisioningFrame.svelte';
export { default as DependencyInstallBanner } from './presentation/DependencyInstallBanner.svelte';
export { default as WorkstreamTitle } from './presentation/WorkstreamTitle.svelte';
export {
	provisioningTopBarStatus,
	type ProvisioningTopBarActions,
} from './presentation/provisioning-top-bar-status';
