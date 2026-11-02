import type { LiveEventEnvelope } from './agent';
import type {
	BrowserResizeRequest,
	BrowserState,
	BrowserTabArgs,
	BrowserThreadOpened,
} from './browser';
import type { LeadDecisionChangedEvent } from './leads';
import type { ChatDeliveryChangedEvent } from './deliveries';
import type { GithubReach } from './github-failure';
import type {
	AgentActionChangedEvent,
	JobDefinitionChangedEvent,
	JobExperimentChangedEvent,
	JobRunChangedEvent,
	JobSuggestedEvent,
	ReconcilerDecisionChangedEvent,
	TimeReachedEvent,
} from './jobs';
import type { McpServerListing, McpServerReport } from './mcp-servers';
import type {
	PullRequestChangedEvent,
	ShipButtonClickedEvent,
	ShipChangedEvent,
	WorkstreamOpenedEvent,
} from './pull-requests';
import type { ExtensionChangedEvent, ExtensionPublishedEvent } from './marketplace';
import type { GitProjectRecord, GitWorkstreamRecord } from './repositories';
import type {
	SecretDeletedEvent,
	SecretRequestDismissedEvent,
	SecretsRequestedEvent,
	SecretsSavedEvent,
} from './secrets';
import type { ShellRun } from './shell-runs';
import type { BestboyProfile, ProfileState, ResourceSample, WorkstreamRunning } from './stats';
import type { InstallSkipReason, InstallStatus } from './system';

export type EmptyEventPayload = Readonly<Record<string, never>>;

export type GithubReachChangedPayload = Readonly<{ reach: GithubReach }>;

export interface RunChangesCapturedPayload {
	sessionId: string;
	runId: string;
}

export interface CheckpointRestoredPayload {
	workstreamId: string;
	checkpointId: string;
	sessionId: string;
}

export interface WorktreeAddedPayload {
	workstreamId: string;
	project: GitProjectRecord;
	workstream: GitWorkstreamRecord;
}

export interface WorktreeRemovedPayload {
	workstreamId: string;
	worktreePath: string;
	archived?: true;
	deleted?: true;
}

export interface WorkstreamFilesChangedPayload {
	workstreamId: string;
	changedAt: string;
	paths: string[] | null;
}

export type ChatTurnFinishedStatus = 'succeeded' | 'failed' | 'cancelled';

export interface ChatTurnFinishedPayload {
	workstreamId: string;
	sessionId: string;
	runId: string;
	status: ChatTurnFinishedStatus;
	outcome: string | null;
	needs: string | null;
	backgroundCommands: readonly string[] | null;
}

export interface SessionRenamedPayload {
	workstreamId: string;
	sessionId: string;
	name: string;
}

export interface WorkstreamRenamedPayload {
	workstreamId: string;
	name: string;
}

export interface WorkstreamInstallStatusPayload {
	type: 'repositories:workstream-install-status';
	workstreamId: string;
	status: InstallStatus;
	command?: string;
	reason?: InstallSkipReason;
	detail?: string;
	durationMs?: number;
	exitCode?: number;
}

export interface WorkstreamSetupStatusPayload {
	workstreamId: string;
	status: 'running' | 'done';
}

export interface WorkstreamMergeConflictedPayload {
	workstreamId: string;
	baseBranch: string;
	conflictedPaths: string[];
}

export interface WorkstreamBaseOverlappedPayload {
	workstreamId: string;
	baseBranch: string;
	head: string;
	baseHead: string;
	behind: number;
	conflicts: boolean;
	conflictedPaths: string[];
	overlappingPaths: string[];
}

export interface WorkstreamHeadMovedPayload {
	workstreamId: string;
	branch: string | null;
	head: string;
	previousHead: string | null;
}

export interface WorkstreamPushedPayload {
	workstreamId: string;
	branch: string;
	head: string;
}

export interface CloneProgressPayload {
	repo_id: string;
	stage: 'fetch' | 'checkout' | 'done';
	fraction: number;
}

export interface LocalBaseSyncedPayload {
	workstreamId: string | null;
	checkout: string;
	branch: string;
	outcome: 'advanced' | 'diverged' | 'failed';
	detail?: string;
}

export type NotificationTarget = Readonly<{ workstreamId: string; sessionId: string }>;

export type MenuCommand =
	'new-workstream' | 'new-chat' | 'open-folder' | 'clone-repository' | 'accounts' | 'settings';

export type MenuCommandChosen = Readonly<{ command: MenuCommand }>;

export type StreamingChangedPayload = Readonly<{ streaming: boolean }>;

export type ContractEventReference = Readonly<{
	channel: string;
	description: string;
	facts: readonly string[];
	payloadType: string;
	payload: string;
}>;

export type ContractReference = Readonly<{ events: readonly ContractEventReference[] }>;

export type ContractPayloadChange = Readonly<{ channel: string; before: string; after: string }>;

export type ContractChanges = Readonly<{
	added: readonly string[];
	removed: readonly string[];
	changed: readonly ContractPayloadChange[];
}>;

export type AppUpdatedPayload = Readonly<{ from: string; to: string; changes: ContractChanges }>;

export type UpdateStagedPayload = Readonly<{ version: string }>;

export type UpdateStatus = Readonly<
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'downloading'; version: string }
	| { state: 'up-to-date'; version: string }
	| { state: 'failed'; error: string }
	| { state: 'ready'; version: string }
>;

export type AppStartedPayload = Readonly<{ version: string }>;

export type FileOpenRequestedPayload = Readonly<{
	workstreamId: string;
	path: string;
	line: number | null;
}>;

export interface ContractEvents {
	'chat:agent-event': LiveEventEnvelope;
	'chat:run-changes-captured': RunChangesCapturedPayload;
	'chat:checkpoint-restored': CheckpointRestoredPayload;
	'chat:session-renamed': SessionRenamedPayload;
	'chat:turn-finished': ChatTurnFinishedPayload;
	'chat:lead-decision-changed': LeadDecisionChangedEvent;
	'chat:delivery-changed': ChatDeliveryChangedEvent;
	'chat:mcp-server-changed': McpServerReport;
	'chat:mcp-servers-listed': McpServerListing;
	'chat:shell-run-changed': ShellRun;
	'repositories:workstream-created': WorktreeAddedPayload;
	'repositories:workstream-removed': WorktreeRemovedPayload;
	'repositories:workstream-files-changed': WorkstreamFilesChangedPayload;
	'repositories:workstream-renamed': WorkstreamRenamedPayload;
	'repositories:workstream-install-status': WorkstreamInstallStatusPayload;
	'repositories:workstream-setup-status': WorkstreamSetupStatusPayload;
	'repositories:workstream-merge-conflicted': WorkstreamMergeConflictedPayload;
	'repositories:workstream-base-overlapped': WorkstreamBaseOverlappedPayload;
	'repositories:workstream-head-moved': WorkstreamHeadMovedPayload;
	'repositories:workstream-pushed': WorkstreamPushedPayload;
	'repositories:clone-progress': CloneProgressPayload;
	'repositories:changed': EmptyEventPayload;
	'repositories:github-reach-changed': GithubReachChangedPayload;
	'pull-requests:local-base-synced': LocalBaseSyncedPayload;
	'pull-requests:ship-changed': ShipChangedEvent;
	'pull-requests:pull-request-changed': PullRequestChangedEvent;
	'pull-requests:button-clicked': ShipButtonClickedEvent;
	'pull-requests:workstream-opened': WorkstreamOpenedEvent;
	'jobs:run-changed': JobRunChangedEvent;
	'jobs:run-started': JobRunChangedEvent;
	'jobs:run-finished': JobRunChangedEvent;
	'jobs:definition-changed': JobDefinitionChangedEvent;
	'jobs:suggested': JobSuggestedEvent;
	'jobs:experiment-changed': JobExperimentChangedEvent;
	'jobs:agent-action-changed': AgentActionChangedEvent;
	'jobs:tool-called': AgentActionChangedEvent;
	'jobs:decision-changed': ReconcilerDecisionChangedEvent;
	'jobs:time-reached': TimeReachedEvent;
	'app:started': AppStartedPayload;
	'app:close-requested': EmptyEventPayload;
	'app:scale-changed': EmptyEventPayload;
	'app:notification-opened': NotificationTarget;
	'app:menu-command-chosen': MenuCommandChosen;
	'app:streaming-changed': StreamingChangedPayload;
	'app:updated': AppUpdatedPayload;
	'app:update-staged': UpdateStagedPayload;
	'app:update-status-changed': UpdateStatus;
	'browser:state-changed': BrowserState;
	'browser:tab-opened': BrowserTabArgs;
	'browser:resize-requested': BrowserResizeRequest;
	'browser:thread-opened': BrowserThreadOpened;
	'extensions:file-open-requested': FileOpenRequestedPayload;
	'stats:resources-sampled': ResourceSample;
	'stats:workstream-running-changed': readonly WorkstreamRunning[];
	'stats:profile-changed': ProfileState;
	'stats:profile-published': BestboyProfile;
	'secrets:requested': SecretsRequestedEvent;
	'secrets:saved': SecretsSavedEvent;
	'secrets:request-dismissed': SecretRequestDismissedEvent;
	'secrets:deleted': SecretDeletedEvent;
	'extensions:changed': ExtensionChangedEvent;
	'extensions:published': ExtensionPublishedEvent;
}

export type EventChannel = keyof ContractEvents;

const EVENT_CHANNEL_INDEX: Readonly<Record<EventChannel, null>> = {
	'chat:agent-event': null,
	'chat:run-changes-captured': null,
	'chat:checkpoint-restored': null,
	'chat:session-renamed': null,
	'chat:turn-finished': null,
	'chat:lead-decision-changed': null,
	'chat:delivery-changed': null,
	'chat:mcp-server-changed': null,
	'chat:mcp-servers-listed': null,
	'chat:shell-run-changed': null,
	'repositories:workstream-created': null,
	'repositories:workstream-removed': null,
	'repositories:workstream-files-changed': null,
	'repositories:workstream-renamed': null,
	'repositories:workstream-install-status': null,
	'repositories:workstream-setup-status': null,
	'repositories:workstream-merge-conflicted': null,
	'repositories:workstream-base-overlapped': null,
	'repositories:workstream-head-moved': null,
	'repositories:workstream-pushed': null,
	'repositories:clone-progress': null,
	'repositories:changed': null,
	'repositories:github-reach-changed': null,
	'pull-requests:local-base-synced': null,
	'pull-requests:ship-changed': null,
	'pull-requests:pull-request-changed': null,
	'pull-requests:button-clicked': null,
	'pull-requests:workstream-opened': null,
	'jobs:run-changed': null,
	'jobs:run-started': null,
	'jobs:run-finished': null,
	'jobs:definition-changed': null,
	'jobs:suggested': null,
	'jobs:experiment-changed': null,
	'jobs:agent-action-changed': null,
	'jobs:tool-called': null,
	'jobs:decision-changed': null,
	'jobs:time-reached': null,
	'app:started': null,
	'app:close-requested': null,
	'app:scale-changed': null,
	'app:notification-opened': null,
	'app:menu-command-chosen': null,
	'app:streaming-changed': null,
	'app:updated': null,
	'app:update-staged': null,
	'app:update-status-changed': null,
	'browser:state-changed': null,
	'browser:tab-opened': null,
	'browser:resize-requested': null,
	'browser:thread-opened': null,
	'extensions:file-open-requested': null,
	'stats:resources-sampled': null,
	'stats:workstream-running-changed': null,
	'stats:profile-changed': null,
	'stats:profile-published': null,
	'secrets:requested': null,
	'secrets:saved': null,
	'secrets:request-dismissed': null,
	'secrets:deleted': null,
	'extensions:changed': null,
	'extensions:published': null,
};

export function isEventChannel(value: string): value is EventChannel {
	return Object.hasOwn(EVENT_CHANNEL_INDEX, value);
}

export const EVENT_CHANNELS: readonly EventChannel[] =
	Object.keys(EVENT_CHANNEL_INDEX).filter(isEventChannel);

export const CHAT_AGENT_EVENT_CHANNEL = 'chat:agent-event' satisfies EventChannel;

export const CHAT_RUN_CHANGES_CAPTURED_CHANNEL = 'chat:run-changes-captured' satisfies EventChannel;

export const CHAT_CHECKPOINT_RESTORED_CHANNEL = 'chat:checkpoint-restored' satisfies EventChannel;

export const CHAT_SESSION_RENAMED_CHANNEL = 'chat:session-renamed' satisfies EventChannel;

export const CHAT_TURN_FINISHED_CHANNEL = 'chat:turn-finished' satisfies EventChannel;

export const CHAT_LEAD_DECISION_CHANGED_CHANNEL =
	'chat:lead-decision-changed' satisfies EventChannel;

export const CHAT_DELIVERY_CHANGED_CHANNEL = 'chat:delivery-changed' satisfies EventChannel;

export const CHAT_MCP_SERVER_CHANGED_CHANNEL = 'chat:mcp-server-changed' satisfies EventChannel;

export const CHAT_MCP_SERVERS_LISTED_CHANNEL = 'chat:mcp-servers-listed' satisfies EventChannel;

export const CHAT_SHELL_RUN_CHANGED_CHANNEL = 'chat:shell-run-changed' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_CREATED_CHANNEL =
	'repositories:workstream-created' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL =
	'repositories:workstream-removed' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL =
	'repositories:workstream-files-changed' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL =
	'repositories:workstream-renamed' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL =
	'repositories:workstream-install-status' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL =
	'repositories:workstream-setup-status' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL =
	'repositories:workstream-merge-conflicted' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL =
	'repositories:workstream-base-overlapped' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL =
	'repositories:workstream-head-moved' satisfies EventChannel;

export const REPOSITORIES_WORKSTREAM_PUSHED_CHANNEL =
	'repositories:workstream-pushed' satisfies EventChannel;

export const REPOSITORIES_CLONE_PROGRESS_CHANNEL =
	'repositories:clone-progress' satisfies EventChannel;

export const REPOSITORIES_GITHUB_REACH_CHANGED_CHANNEL =
	'repositories:github-reach-changed' satisfies EventChannel;

export const APP_STARTED_CHANNEL = 'app:started' satisfies EventChannel;

export const APP_CLOSE_REQUESTED_CHANNEL = 'app:close-requested' satisfies EventChannel;

export const APP_SCALE_CHANGED_CHANNEL = 'app:scale-changed' satisfies EventChannel;

export const APP_NOTIFICATION_OPENED_CHANNEL = 'app:notification-opened' satisfies EventChannel;

export const APP_MENU_COMMAND_CHOSEN_CHANNEL = 'app:menu-command-chosen' satisfies EventChannel;

export const APP_STREAMING_CHANGED_CHANNEL = 'app:streaming-changed' satisfies EventChannel;

export const APP_UPDATED_CHANNEL = 'app:updated' satisfies EventChannel;

export const APP_UPDATE_STAGED_CHANNEL = 'app:update-staged' satisfies EventChannel;

export const APP_UPDATE_STATUS_CHANGED_CHANNEL = 'app:update-status-changed' satisfies EventChannel;

export const BROWSER_STATE_CHANGED_CHANNEL = 'browser:state-changed' satisfies EventChannel;

export const BROWSER_TAB_OPENED_CHANNEL = 'browser:tab-opened' satisfies EventChannel;

export const BROWSER_RESIZE_REQUESTED_CHANNEL = 'browser:resize-requested' satisfies EventChannel;

export const BROWSER_THREAD_OPENED_CHANNEL = 'browser:thread-opened' satisfies EventChannel;

export const EXTENSIONS_FILE_OPEN_REQUESTED_CHANNEL =
	'extensions:file-open-requested' satisfies EventChannel;

export const STATS_RESOURCES_SAMPLED_CHANNEL = 'stats:resources-sampled' satisfies EventChannel;

export const STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL =
	'stats:workstream-running-changed' satisfies EventChannel;

export const STATS_PROFILE_CHANGED_CHANNEL = 'stats:profile-changed' satisfies EventChannel;

export const STATS_PROFILE_PUBLISHED_CHANNEL = 'stats:profile-published' satisfies EventChannel;

export const SECRETS_REQUESTED_CHANNEL = 'secrets:requested' satisfies EventChannel;

export const SECRETS_SAVED_CHANNEL = 'secrets:saved' satisfies EventChannel;

export const SECRETS_REQUEST_DISMISSED_CHANNEL = 'secrets:request-dismissed' satisfies EventChannel;

export const SECRETS_DELETED_CHANNEL = 'secrets:deleted' satisfies EventChannel;

export const EXTENSIONS_CHANGED_CHANNEL = 'extensions:changed' satisfies EventChannel;

export const EXTENSIONS_PUBLISHED_CHANNEL = 'extensions:published' satisfies EventChannel;

export const PULL_REQUESTS_SHIP_CHANGED_CHANNEL =
	'pull-requests:ship-changed' satisfies EventChannel;

export const PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL =
	'pull-requests:pull-request-changed' satisfies EventChannel;

export const PULL_REQUESTS_BUTTON_CLICKED_CHANNEL =
	'pull-requests:button-clicked' satisfies EventChannel;

export const PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL =
	'pull-requests:workstream-opened' satisfies EventChannel;

export const JOBS_RUN_CHANGED_CHANNEL = 'jobs:run-changed' satisfies EventChannel;

export const JOBS_RUN_STARTED_CHANNEL = 'jobs:run-started' satisfies EventChannel;

export const JOBS_RUN_FINISHED_CHANNEL = 'jobs:run-finished' satisfies EventChannel;

export const JOBS_DEFINITION_CHANGED_CHANNEL = 'jobs:definition-changed' satisfies EventChannel;

export const JOBS_SUGGESTED_CHANNEL = 'jobs:suggested' satisfies EventChannel;

export const JOBS_EXPERIMENT_CHANGED_CHANNEL = 'jobs:experiment-changed' satisfies EventChannel;

export const JOBS_AGENT_ACTION_CHANGED_CHANNEL = 'jobs:agent-action-changed' satisfies EventChannel;

export const JOBS_TOOL_CALLED_CHANNEL = 'jobs:tool-called' satisfies EventChannel;

export const JOBS_DECISION_CHANGED_CHANNEL = 'jobs:decision-changed' satisfies EventChannel;

export const JOBS_TIME_REACHED_CHANNEL = 'jobs:time-reached' satisfies EventChannel;

export const REPOSITORIES_CHANGED_CHANNEL = 'repositories:changed' satisfies EventChannel;
