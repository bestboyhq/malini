import type {
	AdoptedAgentAttachment,
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
	AgentSessionOrigin,
	AgentSessionSummary,
	AgentTranscriptReference,
	CheckpointRestoreRedoResult,
	ClaudeSignInOutcome,
	ProviderCapability,
	RestoreCheckpointResult,
	StagedAgentAttachment,
	StagedAgentAttachmentBytes,
} from './agent';
import type { PermissionGrantRecord, RevokePermissionGrantArgs } from './approvals';
import type {
	BrowserElementPrompt,
	BrowserNavigateArgs,
	BrowserShowArgs,
	BrowserState,
	BrowserTabArgs,
} from './browser';
import type { DiagnosticEntry, RecentDiagnosticsArgs, ReportToastArgs } from './diagnostics';
import type { MenuCommandChosen, NotificationTarget } from './events';
import type {
	ChatJobRunsArgs,
	JobDefinitionIdArgs,
	JobDefinitionRecord,
	JobExperimentIdArgs,
	JobExperimentRecord,
	JobExperimentsRecord,
	JobOutputRecord,
	JobOutputsArgs,
	JobRunIdArgs,
	JobRunRecord,
	JobSetupRecord,
	JobSuggestionIdArgs,
	JobSuggestionRecord,
	RunJobArgs,
	SaveJobDefinitionArgs,
	SaveJobExperimentArgs,
} from './jobs';
import type { ReopenPullRequestArgs, ShipStateRecord, ShipWorkstreamArgs } from './pull-requests';
import type {
	ListMcpServersArgs,
	McpAuthorization,
	McpServerArgs,
	McpServerList,
	McpServerNameArgs,
	SwitchMcpServerArgs,
} from './mcp-servers';
import type { ListSkillsArgs, SkillRecord, SkillUsageReport, SwitchSkillArgs } from './skills';
import type { RuntimeInfo } from './runtime';
import type { SaveScratchpadArgs, ScratchpadArgs } from './scratchpad';
import type {
	ActivityStats,
	ResourceHistory,
	ResourceKindBreakdown,
	StopRunningArgs,
	WorkstreamRunning,
} from './stats';
import type {
	AddressedReviewThreadsDto,
	ArchivedWorkstreamDto,
	AuthStatusDto,
	ConnectedRepositoryDto,
	CheckDiagnosticsDto,
	GitHubDeviceCodeDto,
	GitHubSignInOutcome,
	GithubRepositoryDto,
	ImportSource,
	RepositoryConnectionDto,
	OwnerAvatar,
	ProjectDto,
	PullRequestMetadataDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
	WorkstreamBaseSyncOutcome,
	WorkstreamRetirementReceipt,
	WorkstreamDto,
	WorkstreamFileEntry,
	WorkstreamImageRead,
	WorkstreamSnapshot,
	WorktreeChangeTotals,
	WorktreeStatus,
} from './repositories';
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

export type StopBackgroundTaskArgs = Readonly<{ sessionId: string; taskId: string }>;

export type ModelRefreshArgs = Readonly<{ refresh?: boolean }>;

export type ClaudeSignInArgs = Readonly<{ email?: string }>;

export type SecretKeyArgs = Readonly<{ service: string; key: string }>;

export type ExtensionFileArgs = Readonly<{
	extensionId: string;
	workstreamId: string;
	path: string;
}>;

export type StartAgentSessionArgs = Readonly<{
	workstreamId: string;
	model?: string;
	origin?: AgentSessionOrigin;
	displayName?: string;
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
	steer?: boolean;
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
	updatedInput?: Readonly<Record<string, unknown>>;
}>;

export type ListAgentEventsArgs = Readonly<{ sessionId: string; afterSeq: number }>;
export type ListAgentEventPageArgs = Readonly<{
	sessionId: string;
	afterSeq: number;
	beforeSeq: number | null;
	byteBudget: number;
}>;

export type AgentEventPage = Readonly<{
	envelopes: AgentEventEnvelope[];
	startSeq: number;
	complete: boolean;
	overBudget: boolean;
}>;

export type ToolOutputArgs = Readonly<{ sessionId: string; toolCallId: string }>;

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
	defaultBranch?: string;
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

export type SetRepositoryHiddenArgs = RepositoryIdArgs & Readonly<{ hidden: boolean }>;

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

export type AdoptAttachmentsArgs = Readonly<{
	workstreamId: string;
	attachmentIds: readonly string[];
}>;

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

export type SetClipboardTextArgs = Readonly<{ text: string; html?: string }>;

export type SetClipboardImageArgs = Readonly<{ pngDataUrl: string }>;

export type AppendRendererErrorArgs = Readonly<{ payload: RendererErrorPayload }>;

export type SetInterfaceScaleArgs = Readonly<{ scale: number }>;

export type ThemeMode = 'system' | 'light' | 'dark';

export type SetThemeModeArgs = Readonly<{ mode: ThemeMode }>;

export type CloseGuardArgs = Readonly<{ armed: boolean }>;

export type NotifyArgs = Readonly<{
	options: Readonly<{ title: string; body: string; opens?: NotificationTarget }>;
}>;

export type ReadWorkstreamImageArgs = Readonly<{ workstreamId: string; path: string }>;

export interface ContractCommands {
	'browser.show': { args: BrowserShowArgs; result: void };
	'browser.hide': { args: BrowserTabArgs; result: void };
	'browser.navigate': { args: BrowserNavigateArgs; result: void };
	'browser.go-back': { args: BrowserTabArgs; result: void };
	'browser.go-forward': { args: BrowserTabArgs; result: void };
	'browser.reload': { args: BrowserTabArgs; result: void };
	'browser.state': { args: BrowserTabArgs; result: BrowserState };
	'browser.snapshot': { args: BrowserTabArgs; result: string | null };
	'browser.pick-element': { args: BrowserTabArgs; result: BrowserElementPrompt | null };
	'browser.cancel-pick': { args: BrowserTabArgs; result: void };
	'browser.close': { args: BrowserTabArgs; result: void };
	'chat.activate-session': { args: SessionIdArgs; result: void };
	'chat.agent-health': { args: undefined; result: boolean };
	'providers.install-claude-code': { args: undefined; result: void };
	'providers.sign-in-to-claude': { args: ClaudeSignInArgs; result: ClaudeSignInOutcome };
	'providers.cancel-claude-sign-in': { args: undefined; result: void };
	'chat.agent-capabilities': { args: ModelRefreshArgs; result: ProviderCapability[] };
	'chat.workstream-has-open-run': { args: WorkstreamIdArgs; result: boolean };
	'chat.workstream-has-working-run': { args: WorkstreamIdArgs; result: boolean };
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
	'chat.list-permission-grants': { args: undefined; result: PermissionGrantRecord[] };
	'chat.revoke-permission-grant': { args: RevokePermissionGrantArgs; result: void };
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
	'repositories.start-github-sign-in': { args: undefined; result: GitHubDeviceCodeDto };
	'repositories.finish-github-sign-in': { args: undefined; result: GitHubSignInOutcome };
	'repositories.cancel-github-sign-in': { args: undefined; result: void };
	'pull-requests.create': { args: CreatePullRequestArgs; result: PullRequestStatusDto };
	'repositories.connect': { args: ImportRepositoryArgs; result: RepositoryConnectionDto };
	'repositories.list-clones': { args: undefined; result: ConnectedRepositoryDto[] };
	'repositories.list-github-repositories': { args: undefined; result: GithubRepositoryDto[] };
	'pull-requests.mark-ready': {
		args: PullRequestNumberArgs;
		result: PullRequestStatusDto;
	};
	'pull-requests.reopen': { args: ReopenPullRequestArgs; result: PullRequestStatusDto };
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
	'pull-requests.open-draft': { args: ShipWorkstreamArgs; result: ShipStateRecord };
	'pull-requests.queue-merge': { args: ShipWorkstreamArgs; result: ShipStateRecord };
	'pull-requests.cancel-merge': { args: ShipWorkstreamArgs; result: ShipStateRecord | null };
	'pull-requests.retry-merge': { args: ShipWorkstreamArgs; result: ShipStateRecord };
	'pull-requests.ship-states': { args: undefined; result: ShipStateRecord[] };
	'pull-requests.workstream-opened': { args: ShipWorkstreamArgs; result: null };
	'jobs.list-definitions': { args: undefined; result: JobDefinitionRecord[] };
	'jobs.save-definition': { args: SaveJobDefinitionArgs; result: JobDefinitionRecord };
	'jobs.delete-definition': { args: JobDefinitionIdArgs; result: null };
	'jobs.reset-definition': { args: JobDefinitionIdArgs; result: JobDefinitionRecord };
	'jobs.list-runs': { args: undefined; result: JobRunRecord[] };
	'jobs.list-chat-runs': { args: ChatJobRunsArgs; result: JobRunRecord[] };
	'jobs.run': { args: RunJobArgs; result: JobRunRecord };
	'jobs.confirm-run': { args: JobRunIdArgs; result: JobRunRecord };
	'jobs.cancel-run': { args: JobRunIdArgs; result: JobRunRecord };
	'jobs.list-suggestions': { args: undefined; result: JobSuggestionRecord[] };
	'jobs.accept-suggestion': { args: JobSuggestionIdArgs; result: JobDefinitionRecord };
	'jobs.dismiss-suggestion': { args: JobSuggestionIdArgs; result: JobSuggestionRecord };
	'jobs.list-outputs': { args: JobOutputsArgs; result: JobOutputRecord[] };
	'jobs.list-setups': { args: JobDefinitionIdArgs; result: JobSetupRecord[] };
	'jobs.open-experiments': { args: JobDefinitionIdArgs; result: JobExperimentsRecord };
	'jobs.save-experiment': { args: SaveJobExperimentArgs; result: JobExperimentRecord };
	'jobs.delete-experiment': { args: JobExperimentIdArgs; result: null };
	'jobs.run-experiment': { args: JobExperimentIdArgs; result: JobExperimentRecord };
	'jobs.use-experiment': { args: JobExperimentIdArgs; result: JobDefinitionRecord };
	'skills.list': { args: ListSkillsArgs; result: SkillRecord[] };
	'skills.usage': { args: undefined; result: SkillUsageReport };
	'skills.switch': { args: SwitchSkillArgs; result: SkillUsageReport };
	'scratchpad.load': { args: ScratchpadArgs; result: string | null };
	'scratchpad.save': { args: SaveScratchpadArgs; result: void };
	'repositories.list-hidden': { args: undefined; result: string[] };
	'repositories.set-hidden': { args: SetRepositoryHiddenArgs; result: void };
	'chat.list-events': { args: ListAgentEventsArgs; result: AgentEventEnvelope[] };
	'chat.list-event-page': { args: ListAgentEventPageArgs; result: AgentEventPage };
	'chat.tool-output': { args: ToolOutputArgs; result: string | null };
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
	'repositories.list-archived-workstreams': {
		args: undefined;
		result: ArchivedWorkstreamDto[];
	};
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
	'repositories.count-behind-base': { args: PullWorkstreamArgs; result: number };
	'repositories.push-workstream': { args: PushWorkstreamArgs; result: string };
	'repositories.restart-workstream-on-base': { args: RestartWorkstreamOnBaseArgs; result: string };
	'extensions.read-repository-file': { args: ExtensionFileArgs; result: string };
	'extensions.read-workstream-file': { args: ExtensionFileArgs; result: string };
	'chat.read-staged-attachment': {
		args: StagedAttachmentArgs;
		result: StagedAgentAttachmentBytes;
	};
	'repositories.read-workstream-image': {
		args: ReadWorkstreamImageArgs;
		result: WorkstreamImageRead;
	};
	'repositories.record-owned-docker-containers': { args: RecordOwnedContainersArgs; result: void };
	'chat.redo-checkpoint-restore': {
		args: RedoCheckpointRestoreArgs;
		result: CheckpointRestoreRedoResult;
	};
	'chat.refresh-session-status': { args: SessionIdArgs; result: void };
	'chat.authorize-mcp-server': { args: McpServerArgs; result: McpAuthorization };
	'chat.reconnect-mcp-server': { args: McpServerArgs; result: void };
	'chat.list-mcp-servers': { args: ListMcpServersArgs; result: McpServerList };
	'chat.turned-off-mcp-servers': { args: undefined; result: readonly string[] };
	'chat.switch-mcp-server': { args: SwitchMcpServerArgs; result: readonly string[] };
	'chat.cancel-mcp-sign-in': { args: McpServerNameArgs; result: void };
	'repositories.release-owned-docker-container': { args: ReleaseOwnedContainerArgs; result: void };
	'repositories.remove': { args: RepositoryIdArgs; result: void };
	'chat.remove-staged-attachment': { args: StagedAttachmentArgs; result: void };
	'chat.reset-workstream-runs': { args: WorkstreamIdArgs; result: number };
	'chat.restart-agent': { args: undefined; result: void };
	'chat.restore-checkpoint': {
		args: RestoreCheckpointArgs;
		result: RestoreCheckpointResult;
	};
	'repositories.restore-workstream': { args: WorkstreamIdArgs; result: void };
	'repositories.reveal-workstream': { args: WorkstreamIdArgs; result: void };
	'repositories.sync-workstream-base': {
		args: WorkstreamIdArgs;
		result: WorkstreamBaseSyncOutcome;
	};
	'repositories.sync-own-pull-requests': { args: undefined; result: string[] };
	'extensions.rollback-managed': {
		args: ExtensionIdArgs;
		result: ManagedExtensionSourceSnapshot;
	};
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
	'chat.adopt-attachments': {
		args: AdoptAttachmentsArgs;
		result: AdoptedAgentAttachment[];
	};
	'chat.renew-staged-attachments': { args: AdoptAttachmentsArgs; result: void };
	'chat.stage-fork-transcript': {
		args: StageForkTranscriptArgs;
		result: StagedAgentAttachment;
	};
	'chat.stop-background-task': { args: StopBackgroundTaskArgs; result: void };
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
	'app.copy-image': { args: SetClipboardImageArgs; result: void };
	'app.focus-window': { args: undefined; result: void };
	'app.runtime-identity': { args: undefined; result: DesktopRuntimeIdentity };
	'app.delete-secret': { args: SecretKeyArgs; result: void };
	'app.get-secret': { args: SecretKeyArgs; result: string | null };
	'app.set-secret': { args: SetSecretArgs; result: void };
	'app.open-external-url': { args: OpenExternalUrlArgs; result: void };
	'app.notification-permission-granted': { args: undefined; result: boolean | null };
	'app.notify': { args: NotifyArgs; result: void };
	'app.take-notification-target': { args: undefined; result: NotificationTarget | null };
	'app.take-menu-command': {
		args: undefined;
		result: MenuCommandChosen | null;
	};
	'app.request-notification-permission': {
		args: undefined;
		result: NotificationPermissionResult;
	};
	'app.close-guard': { args: CloseGuardArgs; result: void };
	'app.destroy-window': { args: undefined; result: void };
	'app.logical-viewport': { args: undefined; result: LogicalViewport };
	'app.interface-scale': { args: SetInterfaceScaleArgs; result: void };
	'app.theme-mode': { args: SetThemeModeArgs; result: void };
	'app.runtime-info': { args: undefined; result: RuntimeInfo };
	'app.streaming': { args: undefined; result: boolean };
	'app.staged-update': { args: undefined; result: string | null };
	'app.restart-to-update': { args: undefined; result: void };
	'stats.activity': { args: undefined; result: ActivityStats };
	'stats.resources': { args: undefined; result: ResourceHistory };
	'stats.resource-breakdown': { args: undefined; result: readonly ResourceKindBreakdown[] };
	'stats.workstream-running': { args: undefined; result: readonly WorkstreamRunning[] };
	'stats.stop-running': { args: StopRunningArgs; result: void };
}

export type CommandName = keyof ContractCommands;

export type CommandArgs<Name extends CommandName> = ContractCommands[Name]['args'];

export type CommandResult<Name extends CommandName> = ContractCommands[Name]['result'];

export const COMMAND_NAMES: readonly CommandName[] = [
	'browser.show',
	'browser.hide',
	'browser.navigate',
	'browser.go-back',
	'browser.go-forward',
	'browser.reload',
	'browser.state',
	'browser.snapshot',
	'browser.pick-element',
	'browser.cancel-pick',
	'browser.close',
	'app.copy-text',
	'app.copy-image',
	'chat.activate-session',
	'chat.adopt-attachments',
	'chat.agent-health',
	'providers.install-claude-code',
	'providers.sign-in-to-claude',
	'providers.cancel-claude-sign-in',
	'chat.agent-capabilities',
	'chat.workstream-has-open-run',
	'chat.workstream-has-working-run',
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
	'chat.list-permission-grants',
	'chat.revoke-permission-grant',
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
	'repositories.start-github-sign-in',
	'repositories.finish-github-sign-in',
	'repositories.cancel-github-sign-in',
	'pull-requests.create',
	'repositories.connect',
	'repositories.list-clones',
	'repositories.list-github-repositories',
	'pull-requests.mark-ready',
	'pull-requests.reopen',
	'pull-requests.merge',
	'pull-requests.update-metadata',
	'repositories.owner-avatar',
	'pull-requests.check-diagnostics',
	'pull-requests.review-feedback',
	'pull-requests.resolve-addressed-review-threads',
	'pull-requests.status',
	'pull-requests.open-draft',
	'pull-requests.queue-merge',
	'pull-requests.cancel-merge',
	'pull-requests.retry-merge',
	'pull-requests.ship-states',
	'pull-requests.workstream-opened',
	'jobs.list-definitions',
	'jobs.save-definition',
	'jobs.delete-definition',
	'jobs.reset-definition',
	'jobs.list-runs',
	'jobs.list-chat-runs',
	'jobs.run',
	'jobs.confirm-run',
	'jobs.cancel-run',
	'jobs.list-suggestions',
	'jobs.accept-suggestion',
	'jobs.dismiss-suggestion',
	'jobs.list-outputs',
	'jobs.list-setups',
	'jobs.open-experiments',
	'jobs.save-experiment',
	'jobs.delete-experiment',
	'jobs.run-experiment',
	'jobs.use-experiment',
	'skills.list',
	'skills.usage',
	'skills.switch',
	'scratchpad.load',
	'scratchpad.save',
	'repositories.list-hidden',
	'repositories.set-hidden',
	'chat.list-events',
	'chat.list-event-page',
	'chat.tool-output',
	'chat.list-sessions',
	'extensions.list-sources',
	'extensions.list-workstream-files',
	'extensions.list-managed',
	'repositories.list-owned-docker-containers',
	'repositories.list-repositories',
	'repositories.workstream-files',
	'repositories.base-files',
	'repositories.list-workstreams',
	'repositories.list-archived-workstreams',
	'repositories.open-workstream-in-editor',
	'app.shutdown-impact',
	'chat.pick-and-stage-attachments',
	'repositories.pick-folder',
	'repositories.provision-dependencies',
	'repositories.pull-workstream',
	'repositories.count-behind-base',
	'repositories.push-workstream',
	'repositories.restart-workstream-on-base',
	'extensions.read-repository-file',
	'extensions.read-workstream-file',
	'chat.read-staged-attachment',
	'repositories.read-workstream-image',
	'repositories.record-owned-docker-containers',
	'chat.redo-checkpoint-restore',
	'chat.refresh-session-status',
	'chat.authorize-mcp-server',
	'chat.reconnect-mcp-server',
	'chat.list-mcp-servers',
	'chat.turned-off-mcp-servers',
	'chat.switch-mcp-server',
	'chat.cancel-mcp-sign-in',
	'repositories.release-owned-docker-container',
	'repositories.remove',
	'chat.remove-staged-attachment',
	'chat.renew-staged-attachments',
	'chat.reset-workstream-runs',
	'chat.restart-agent',
	'chat.restore-checkpoint',
	'repositories.restore-workstream',
	'repositories.reveal-workstream',
	'repositories.sync-workstream-base',
	'repositories.sync-own-pull-requests',
	'extensions.rollback-managed',
	'chat.send-prompt',
	'app.set-setting',
	'extensions.set-managed-enabled',
	'app.shutdown-gracefully',
	'chat.stage-attachment-bytes',
	'chat.stage-fork-transcript',
	'chat.start-session',
	'chat.stop-background-task',
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
	'app.take-menu-command',
	'app.request-notification-permission',
	'app.close-guard',
	'app.destroy-window',
	'app.logical-viewport',
	'app.interface-scale',
	'app.theme-mode',
	'app.runtime-info',
	'app.streaming',
	'app.staged-update',
	'app.restart-to-update',
	'stats.activity',
	'stats.resources',
	'stats.resource-breakdown',
	'stats.workstream-running',
	'stats.stop-running',
];
