import type {
	AgentApprovalDecision,
	AgentApprovalDecisionResult,
	AgentApprovalScope,
	AgentElementReference,
	AgentEventEnvelope,
	AgentQuestionAnswer,
	AgentRunChangePatch,
	AgentRunProfile,
	AgentSessionChangePatch,
	AgentSessionChanges,
	AgentSessionChangeScope,
	AgentSessionSummary,
	AgentTranscriptReference,
	CheckpointRestoreRedoResult,
	ClaudeSetupStep,
	ProviderCapability,
	RestoreCheckpointResult,
	StagedAgentAttachment,
	StagedAgentAttachmentBytes,
} from './agent';
import type { DiagnosticEntry, RecentDiagnosticsArgs, ReportToastArgs } from './diagnostics';
import type { NotificationTarget } from './events';
import type { RuntimeInfo } from './runtime';
import type {
	AddressedReviewThreadsDto,
	AuthStatusDto,
	ConnectedRepositoryDto,
	CheckDiagnosticsDto,
	GithubRepositoryDto,
	ImportSource,
	OwnerAvatar,
	ProjectDto,
	PullRequestMetadataDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
	WorkstreamBaseSyncOutcome,
	WorkstreamRetirementReceipt,
	WorkstreamDto,
	WorkstreamFileEntry,
	WorkstreamImageBytes,
	WorkstreamSnapshot,
	WorktreeChangeTotals,
	WorktreeStatus,
} from './repositories';
import type {
	CreateRoutineDraftArgs,
	ListRoutineGatedRunsArgs,
	RecordRoutineGatedRunArgs,
	RoutineGatedRunIdArgs,
	RoutineGatedRunRecord,
	RoutineIdArgs,
	RoutineRecord,
	RoutineSuggestionIdArgs,
	RoutineSuggestionRecord,
} from './routines';
import type {
	DesktopRuntimeIdentity,
	DockerOwnershipHandshake,
	ExtensionDevelopmentLog,
	ExtensionFileStat,
	ExtensionSourceSnapshot,
	InstallOutcomeStatus,
	LogicalViewport,
	ManagedExtensionSourceSnapshot,
	NotificationPermissionResult,
	OwnedContainer,
	RendererErrorPayload,
	RendererErrorReceipt,
	ShutdownImpact,
	ShutdownOutcome,
	StartedContainerInput,
} from './system';

export type WorkstreamIdArgs = Readonly<{ workstreamId: string }>;

export type RepositoryBaseFilesArgs = Readonly<{ repoPath: string; baseBranch: string }>;

export type SessionIdArgs = Readonly<{ sessionId: string }>;

export type CancelRunArgs = Readonly<{ sessionId: string; pendingRunId?: string | null }>;

export type ModelRefreshArgs = Readonly<{ refresh?: boolean }>;

export type ClaudeSetupArgs = Readonly<{ step: ClaudeSetupStep }>;

export type SecretKeyArgs = Readonly<{ service: string; key: string }>;

export type ExtensionFileArgs = Readonly<{
	extensionId: string;
	workstreamId: string;
	path: string;
}>;

export type StartAgentSessionArgs = Readonly<{
	workstreamId: string;
	model?: string;
}>;

export type StageForkTranscriptArgs = Readonly<{
	workstreamId: string;
	sessionId: string;
	atSeq: number;
}>;

export type SendAgentPromptArgs = Readonly<{
	sessionId: string;
	prompt: string;
	clientRequestId?: string;
	contextFiles?: readonly string[];
	attachmentIds?: readonly string[];
	transcriptReferences?: readonly AgentTranscriptReference[];
	elementReferences?: readonly AgentElementReference[];
	profile?: AgentRunProfile;
	automated?: boolean;
}>;

export type AnswerAgentQuestionArgs = Readonly<{
	sessionId: string;
	runId: string;
	questionId: string;
	answers: readonly AgentQuestionAnswer[];
}>;

export type DecideAgentApprovalArgs = Readonly<{
	sessionId: string;
	runId: string;
	approvalId: string;
	decision: AgentApprovalDecision;
	scope: AgentApprovalScope;
	permission?: unknown;
}>;

export type ListAgentEventsArgs = Readonly<{ sessionId: string; afterSeq: number }>;
export type ListRecentAgentEventsArgs = Readonly<{ sessionId: string; byteBudget: number }>;

export type RecentAgentEvents = Readonly<{ envelopes: AgentEventEnvelope[]; overBudget: boolean }>;

export type SessionChangesArgs = AgentSessionChangeScope & Readonly<{ sessionId: string }>;

export type SessionChangePatchArgs = SessionChangesArgs & Readonly<{ path: string }>;

export type RunChangePatchArgs = SessionChangesArgs &
	Readonly<{ runId: string; path?: string | null }>;

export type RestoreCheckpointArgs = Readonly<{ workstreamId: string; checkpointId: string }>;

export type RedoCheckpointRestoreArgs = Readonly<{
	workstreamId: string;
	sessionId: string;
	restoreSeq: number;
}>;

export type CreateProjectArgs = Readonly<{
	repoUrl: string;
	githubToken?: string | null;
}>;

export type CreateWorkstreamArgs = Readonly<{
	projectRepoPath: string;
	workstreamId: string;
	baseBranch: string;
	projectId: string;
	name: string;
	githubToken?: string | null;
}>;

export type WorkstreamDiffArgs = Readonly<{
	workstreamId: string;
	path?: string | null;
	baseBranch?: string | null;
}>;

export type WorkstreamBaseBranchArgs = Readonly<{ workstreamId: string; baseBranch: string }>;

export type CommitWorkstreamRun = Readonly<{ id: string; messageIfAlreadyCommitted: string }>;

export type CommitWorkstreamArgs = Readonly<{
	workstreamId: string;
	message: string;
	run?: CommitWorkstreamRun | null;
}>;

export type PushWorkstreamArgs = Readonly<{
	workstreamId: string;
	expectedRepositoryFullName: string;
	githubToken?: string | null;
}>;

export type PullWorkstreamArgs = Readonly<{
	workstreamId: string;
	baseBranch: string;
	githubToken?: string | null;
}>;

export type RestartWorkstreamOnBaseArgs = Readonly<{
	workstreamId: string;
	baseBranch: string;
	mergedHeadSha: string;
	expectedRepositoryFullName: string;
	githubToken?: string | null;
}>;

export type RepositoryIdArgs = Readonly<{ repoId: string }>;

export type ImportRepositoryArgs = Readonly<{ source: ImportSource }>;

export type OwnerAvatarArgs = Readonly<{ owner: string }>;

export type PullRequestWorkstreamArgs = Readonly<{ workstreamId?: string }>;

export type PullRequestStatusArgs = RepositoryIdArgs &
	PullRequestWorkstreamArgs &
	Readonly<{ head: string; base?: string | null; pullRequestNumber?: number | null }>;

export type CreatePullRequestArgs = RepositoryIdArgs &
	PullRequestWorkstreamArgs &
	Readonly<{
		head: string;
		base?: string | null;
		title: string;
		body?: string | null;
		draft?: boolean;
	}>;

export type PullRequestNumberArgs = RepositoryIdArgs &
	PullRequestWorkstreamArgs &
	Readonly<{ pullRequestNumber: number }>;

export type MergePullRequestArgs = PullRequestNumberArgs &
	Readonly<{
		expectedHeadSha: string;
		mergeMethod?: string | null;
		commitTitle?: string | null;
		commitMessage?: string | null;
	}>;

export type PullRequestTextUpdate = Readonly<{ expected: string; next: string }>;

export type UpdatePullRequestMetadataArgs = PullRequestNumberArgs &
	Readonly<{ title?: PullRequestTextUpdate; body?: PullRequestTextUpdate }>;

export type ResolveAddressedReviewThreadsArgs = Readonly<{ workstreamId: string; runId: string }>;

export type SetSettingArgs = Readonly<{ key: string; value: string }>;

export type StageAttachmentBytesArgs = Readonly<{
	workstreamId: string;
	fileName: string;
	base64: string;
}>;

export type StagedAttachmentArgs = Readonly<{ workstreamId: string; attachmentId: string }>;

export type ClaimDockerServiceArgs = Readonly<{
	repository: string;
	scope: string;
	workstreamId: string;
	service: string;
	owner: string;
	composeProject?: string | null;
}>;

export type RecordOwnedContainersArgs = Readonly<{
	containers: readonly StartedContainerInput[];
}>;

export type ReleaseOwnedContainerArgs = Readonly<{ containerId: string }>;

export type ExtensionIdArgs = Readonly<{ extensionId: string }>;

export type SetManagedExtensionEnabledArgs = ExtensionIdArgs & Readonly<{ enabled: boolean }>;

export type AppendExtensionDevelopmentLogArgs = Readonly<{ log: ExtensionDevelopmentLog }>;

export type ListExtensionWorkstreamFilesArgs = Readonly<{
	extensionId: string;
	workstreamId: string;
	glob?: string | null;
}>;

export type WriteExtensionWorkstreamFileArgs = ExtensionFileArgs & Readonly<{ contents: string }>;

export type SetSecretArgs = SecretKeyArgs & Readonly<{ value: string }>;

export type OpenExternalUrlArgs = Readonly<{ url: string }>;

export type SetClipboardTextArgs = Readonly<{ text: string }>;

export type AppendRendererErrorArgs = Readonly<{ payload: RendererErrorPayload }>;

export type SetInterfaceScaleArgs = Readonly<{ scale: number }>;

export type CloseGuardArgs = Readonly<{ armed: boolean }>;

export type NotifyArgs = Readonly<{
	options: Readonly<{ title: string; body: string; opens?: NotificationTarget }>;
}>;

export type ReadWorkstreamImageArgs = Readonly<{ workstreamId: string; path: string }>;

export interface ContractCommands {
	'chat.activate-session': { args: SessionIdArgs; result: void };
	'chat.agent-health': { args: undefined; result: boolean };
	'providers.run-claude-setup': { args: ClaudeSetupArgs; result: void };
	'chat.agent-capabilities': { args: ModelRefreshArgs; result: ProviderCapability[] };
	'chat.workstream-has-open-run': { args: WorkstreamIdArgs; result: boolean };
	'chat.answer-question': { args: AnswerAgentQuestionArgs; result: void };
	'extensions.append-development-log': {
		args: AppendExtensionDevelopmentLogArgs;
		result: void;
	};
	'app.report-renderer-error': { args: AppendRendererErrorArgs; result: RendererErrorReceipt };
	'app.report-toast': { args: ReportToastArgs; result: RendererErrorReceipt };
	'app.recent-diagnostics': { args: RecentDiagnosticsArgs; result: DiagnosticEntry[] };
	'repositories.abort-workstream-operation': { args: WorkstreamIdArgs; result: void };
	'chat.archive-session': { args: SessionIdArgs; result: void };
	'repositories.archive-workstream': {
		args: WorkstreamIdArgs;
		result: WorkstreamRetirementReceipt;
	};
	'chat.cancel-run': { args: CancelRunArgs; result: void };
	'repositories.claim-docker-service': {
		args: ClaimDockerServiceArgs;
		result: DockerOwnershipHandshake;
	};
	'repositories.commit-workstream': { args: CommitWorkstreamArgs; result: string };
	'repositories.create-repository': { args: CreateProjectArgs; result: string };
	'repositories.create-workstream': { args: CreateWorkstreamArgs; result: string };
	'chat.decide-approval': {
		args: DecideAgentApprovalArgs;
		result: AgentApprovalDecisionResult;
	};
	'repositories.delete-workstream': {
		args: WorkstreamIdArgs;
		result: WorkstreamRetirementReceipt;
	};
	'extensions.recovery-mode-enabled': { args: undefined; result: boolean };
	'chat.run-change-patch': { args: RunChangePatchArgs; result: AgentRunChangePatch };
	'chat.session-change-patch': {
		args: SessionChangePatchArgs;
		result: AgentSessionChangePatch;
	};
	'chat.session-changes': { args: SessionChangesArgs; result: AgentSessionChanges };
	'app.list-settings': { args: undefined; result: Record<string, string> };
	'chat.get-or-create-session': { args: StartAgentSessionArgs; result: string };
	'repositories.workstream-change-totals': {
		args: WorkstreamBaseBranchArgs;
		result: WorktreeChangeTotals;
	};
	'repositories.workstream-diff': { args: WorkstreamDiffArgs; result: string };
	'repositories.workstream-snapshot': {
		args: WorkstreamBaseBranchArgs;
		result: WorkstreamSnapshot;
	};
	'repositories.workstream-status': { args: WorkstreamIdArgs; result: WorktreeStatus };
	'repositories.github-auth-status': { args: undefined; result: AuthStatusDto };
	'pull-requests.create': { args: CreatePullRequestArgs; result: PullRequestStatusDto };
	'repositories.connect': { args: ImportRepositoryArgs; result: ConnectedRepositoryDto };
	'repositories.list-clones': { args: undefined; result: ConnectedRepositoryDto[] };
	'repositories.list-github-repositories': { args: undefined; result: GithubRepositoryDto[] };
	'pull-requests.mark-ready': {
		args: PullRequestNumberArgs;
		result: PullRequestStatusDto;
	};
	'pull-requests.merge': { args: MergePullRequestArgs; result: PullRequestStatusDto };
	'pull-requests.update-metadata': {
		args: UpdatePullRequestMetadataArgs;
		result: PullRequestMetadataDto;
	};
	'repositories.owner-avatar': { args: OwnerAvatarArgs; result: OwnerAvatar | null };
	'pull-requests.check-diagnostics': {
		args: PullRequestNumberArgs;
		result: CheckDiagnosticsDto;
	};
	'pull-requests.review-feedback': {
		args: PullRequestNumberArgs;
		result: ReviewFeedbackDto;
	};
	'pull-requests.resolve-addressed-review-threads': {
		args: ResolveAddressedReviewThreadsArgs;
		result: AddressedReviewThreadsDto;
	};
	'pull-requests.status': { args: PullRequestStatusArgs; result: PullRequestStatusDto };
	'repositories.disconnect': { args: RepositoryIdArgs; result: void };
	'chat.list-events': { args: ListAgentEventsArgs; result: AgentEventEnvelope[] };
	'chat.list-recent-events': { args: ListRecentAgentEventsArgs; result: RecentAgentEvents };
	'chat.list-sessions': { args: WorkstreamIdArgs; result: AgentSessionSummary[] };
	'extensions.list-sources': { args: undefined; result: ExtensionSourceSnapshot[] };
	'extensions.list-workstream-files': {
		args: ListExtensionWorkstreamFilesArgs;
		result: string[];
	};
	'extensions.list-managed': { args: undefined; result: ManagedExtensionSourceSnapshot[] };
	'repositories.list-owned-docker-containers': { args: undefined; result: OwnedContainer[] };
	'repositories.list-repositories': { args: undefined; result: ProjectDto[] };
	'repositories.workstream-files': { args: WorkstreamIdArgs; result: WorkstreamFileEntry[] };
	'repositories.base-files': { args: RepositoryBaseFilesArgs; result: string[] };
	'repositories.list-workstreams': { args: undefined; result: WorkstreamDto[] };
	'repositories.open-workstream-in-editor': { args: WorkstreamIdArgs; result: void };
	'app.shutdown-impact': { args: undefined; result: ShutdownImpact };
	'chat.pick-and-stage-attachments': {
		args: WorkstreamIdArgs;
		result: StagedAgentAttachment[];
	};
	'repositories.pick-folder': { args: undefined; result: string | null };
	'repositories.provision-dependencies': {
		args: WorkstreamIdArgs;
		result: InstallOutcomeStatus;
	};
	'repositories.pull-workstream': { args: PullWorkstreamArgs; result: string };
	'repositories.push-workstream': { args: PushWorkstreamArgs; result: string };
	'repositories.restart-workstream-on-base': { args: RestartWorkstreamOnBaseArgs; result: string };
	'extensions.read-repository-file': { args: ExtensionFileArgs; result: string };
	'extensions.read-workstream-file': { args: ExtensionFileArgs; result: string };
	'chat.read-staged-attachment': {
		args: StagedAttachmentArgs;
		result: StagedAgentAttachmentBytes | null;
	};
	'repositories.read-workstream-image': {
		args: ReadWorkstreamImageArgs;
		result: WorkstreamImageBytes | null;
	};
	'repositories.record-owned-docker-containers': { args: RecordOwnedContainersArgs; result: void };
	'chat.redo-checkpoint-restore': {
		args: RedoCheckpointRestoreArgs;
		result: CheckpointRestoreRedoResult;
	};
	'chat.refresh-mcp-status': { args: SessionIdArgs; result: void };
	'repositories.release-owned-docker-container': { args: ReleaseOwnedContainerArgs; result: void };
	'repositories.remove': { args: RepositoryIdArgs; result: void };
	'chat.remove-staged-attachment': { args: StagedAttachmentArgs; result: void };
	'chat.reset-workstream-runs': { args: WorkstreamIdArgs; result: number };
	'chat.restart-agent': { args: undefined; result: void };
	'chat.restore-checkpoint': {
		args: RestoreCheckpointArgs;
		result: RestoreCheckpointResult;
	};
	'repositories.reveal-workstream': { args: WorkstreamIdArgs; result: void };
	'repositories.sync-workstream-base': {
		args: WorkstreamIdArgs;
		result: WorkstreamBaseSyncOutcome;
	};
	'extensions.rollback-managed': {
		args: ExtensionIdArgs;
		result: ManagedExtensionSourceSnapshot;
	};
	'routines.confirm-run': { args: RoutineGatedRunIdArgs; result: RoutineGatedRunRecord };
	'routines.create-draft': { args: CreateRoutineDraftArgs; result: RoutineRecord };
	'routines.delete': { args: RoutineIdArgs; result: null };
	'routines.demote': { args: RoutineIdArgs; result: RoutineRecord };
	'routines.dismiss-suggestion': {
		args: RoutineSuggestionIdArgs;
		result: RoutineSuggestionRecord;
	};
	'routines.list': { args: undefined; result: RoutineRecord[] };
	'routines.list-gated-runs': {
		args: ListRoutineGatedRunsArgs;
		result: RoutineGatedRunRecord[];
	};
	'routines.list-suggestions': { args: undefined; result: RoutineSuggestionRecord[] };
	'routines.promote': { args: RoutineIdArgs; result: RoutineRecord };
	'routines.record-gated-run': {
		args: RecordRoutineGatedRunArgs;
		result: RoutineGatedRunRecord;
	};
	'routines.reject-run': { args: RoutineGatedRunIdArgs; result: RoutineGatedRunRecord };
	'chat.send-prompt': { args: SendAgentPromptArgs; result: string };
	'app.set-setting': { args: SetSettingArgs; result: void };
	'extensions.set-managed-enabled': {
		args: SetManagedExtensionEnabledArgs;
		result: ManagedExtensionSourceSnapshot;
	};
	'app.shutdown-gracefully': { args: undefined; result: ShutdownOutcome };
	'chat.stage-attachment-bytes': {
		args: StageAttachmentBytesArgs;
		result: StagedAgentAttachment;
	};
	'chat.stage-fork-transcript': {
		args: StageForkTranscriptArgs;
		result: StagedAgentAttachment;
	};
	'chat.start-session': { args: StartAgentSessionArgs; result: string };
	'extensions.stat-workstream-file': {
		args: ExtensionFileArgs;
		result: ExtensionFileStat | null;
	};
	'extensions.write-workstream-file': {
		args: WriteExtensionWorkstreamFileArgs;
		result: void;
	};
	'app.copy-text': { args: SetClipboardTextArgs; result: void };
	'app.focus-window': { args: undefined; result: void };
	'app.runtime-identity': { args: undefined; result: DesktopRuntimeIdentity };
	'app.delete-secret': { args: SecretKeyArgs; result: void };
	'app.get-secret': { args: SecretKeyArgs; result: string | null };
	'app.set-secret': { args: SetSecretArgs; result: void };
	'app.open-external-url': { args: OpenExternalUrlArgs; result: void };
	'app.notification-permission-granted': { args: undefined; result: boolean | null };
	'app.notify': { args: NotifyArgs; result: void };
	'app.take-notification-target': { args: undefined; result: NotificationTarget | null };
	'app.request-notification-permission': {
		args: undefined;
		result: NotificationPermissionResult;
	};
	'app.close-guard': { args: CloseGuardArgs; result: void };
	'app.destroy-window': { args: undefined; result: void };
	'app.logical-viewport': { args: undefined; result: LogicalViewport };
	'app.interface-scale': { args: SetInterfaceScaleArgs; result: void };
	'app.runtime-info': { args: undefined; result: RuntimeInfo };
}

export type CommandName = keyof ContractCommands;

export type CommandArgs<Name extends CommandName> = ContractCommands[Name]['args'];

export type CommandResult<Name extends CommandName> = ContractCommands[Name]['result'];

export const COMMAND_NAMES: readonly CommandName[] = [
	'app.copy-text',
	'chat.activate-session',
	'chat.agent-health',
	'providers.run-claude-setup',
	'chat.agent-capabilities',
	'chat.workstream-has-open-run',
	'chat.answer-question',
	'extensions.append-development-log',
	'app.report-renderer-error',
	'app.report-toast',
	'app.recent-diagnostics',
	'repositories.abort-workstream-operation',
	'chat.archive-session',
	'repositories.archive-workstream',
	'chat.cancel-run',
	'repositories.claim-docker-service',
	'repositories.commit-workstream',
	'repositories.create-repository',
	'repositories.create-workstream',
	'chat.decide-approval',
	'repositories.delete-workstream',
	'extensions.recovery-mode-enabled',
	'chat.run-change-patch',
	'chat.session-change-patch',
	'chat.session-changes',
	'app.list-settings',
	'chat.get-or-create-session',
	'repositories.workstream-change-totals',
	'repositories.workstream-diff',
	'repositories.workstream-snapshot',
	'repositories.workstream-status',
	'repositories.github-auth-status',
	'pull-requests.create',
	'repositories.connect',
	'repositories.list-clones',
	'repositories.list-github-repositories',
	'pull-requests.mark-ready',
	'pull-requests.merge',
	'pull-requests.update-metadata',
	'repositories.owner-avatar',
	'pull-requests.check-diagnostics',
	'pull-requests.review-feedback',
	'pull-requests.resolve-addressed-review-threads',
	'pull-requests.status',
	'repositories.disconnect',
	'chat.list-events',
	'chat.list-recent-events',
	'chat.list-sessions',
	'extensions.list-sources',
	'extensions.list-workstream-files',
	'extensions.list-managed',
	'repositories.list-owned-docker-containers',
	'repositories.list-repositories',
	'repositories.workstream-files',
	'repositories.base-files',
	'repositories.list-workstreams',
	'repositories.open-workstream-in-editor',
	'app.shutdown-impact',
	'chat.pick-and-stage-attachments',
	'repositories.pick-folder',
	'repositories.provision-dependencies',
	'repositories.pull-workstream',
	'repositories.push-workstream',
	'repositories.restart-workstream-on-base',
	'extensions.read-repository-file',
	'extensions.read-workstream-file',
	'chat.read-staged-attachment',
	'repositories.read-workstream-image',
	'repositories.record-owned-docker-containers',
	'chat.redo-checkpoint-restore',
	'chat.refresh-mcp-status',
	'repositories.release-owned-docker-container',
	'repositories.remove',
	'chat.remove-staged-attachment',
	'chat.reset-workstream-runs',
	'chat.restart-agent',
	'chat.restore-checkpoint',
	'repositories.reveal-workstream',
	'repositories.sync-workstream-base',
	'extensions.rollback-managed',
	'routines.confirm-run',
	'routines.create-draft',
	'routines.delete',
	'routines.demote',
	'routines.dismiss-suggestion',
	'routines.list',
	'routines.list-gated-runs',
	'routines.list-suggestions',
	'routines.promote',
	'routines.record-gated-run',
	'routines.reject-run',
	'chat.send-prompt',
	'app.set-setting',
	'extensions.set-managed-enabled',
	'app.shutdown-gracefully',
	'chat.stage-attachment-bytes',
	'chat.stage-fork-transcript',
	'chat.start-session',
	'extensions.stat-workstream-file',
	'extensions.write-workstream-file',
	'app.focus-window',
	'app.runtime-identity',
	'app.delete-secret',
	'app.get-secret',
	'app.set-secret',
	'app.open-external-url',
	'app.notification-permission-granted',
	'app.notify',
	'app.take-notification-target',
	'app.request-notification-permission',
	'app.close-guard',
	'app.destroy-window',
	'app.logical-viewport',
	'app.interface-scale',
	'app.runtime-info',
];
