import type { LiveEventEnvelope } from './agent';
import type { BrowserState, BrowserTabArgs } from './browser';
import type { JobDefinitionChangedEvent, JobRunChangedEvent, JobSuggestedEvent } from './jobs';
import type { McpServerReport } from './mcp-servers';
import type { ShipChangedEvent } from './pull-requests';
import type { GitProjectRecord, GitWorkstreamRecord } from './repositories';
import type { ResourceSample, WorkstreamRunning } from './stats';
import type { InstallSkipReason, InstallStatus } from './system';

export type EmptyEventPayload = Readonly<Record<string, never>>;

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

export interface WorkstreamMergeConflictedPayload {
	workstreamId: string;
	baseBranch: string;
	conflictedPaths: string[];
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
	'new-workstream' | 'new-chat' | 'open-folder' | 'clone-repository' | 'settings';

export type MenuCommandChosen = Readonly<{ command: MenuCommand }>;

export type StreamingChangedPayload = Readonly<{ streaming: boolean }>;

export type ContractEventReference = Readonly<{
	channel: string;
	description: string;
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

export interface ContractEvents {
	'chat:agent-event': LiveEventEnvelope;
	'chat:run-changes-captured': RunChangesCapturedPayload;
	'chat:checkpoint-restored': CheckpointRestoredPayload;
	'chat:session-renamed': SessionRenamedPayload;
	'chat:mcp-server-changed': McpServerReport;
	'repositories:workstream-created': WorktreeAddedPayload;
	'repositories:workstream-removed': WorktreeRemovedPayload;
	'repositories:workstream-files-changed': WorkstreamFilesChangedPayload;
	'repositories:workstream-renamed': WorkstreamRenamedPayload;
	'repositories:workstream-install-status': WorkstreamInstallStatusPayload;
	'repositories:workstream-merge-conflicted': WorkstreamMergeConflictedPayload;
	'repositories:clone-progress': CloneProgressPayload;
	'pull-requests:local-base-synced': LocalBaseSyncedPayload;
	'pull-requests:ship-changed': ShipChangedEvent;
	'jobs:run-changed': JobRunChangedEvent;
	'jobs:definition-changed': JobDefinitionChangedEvent;
	'jobs:suggested': JobSuggestedEvent;
	'app:close-requested': EmptyEventPayload;
	'app:scale-changed': EmptyEventPayload;
	'app:notification-opened': NotificationTarget;
	'app:menu-command-chosen': MenuCommandChosen;
	'app:streaming-changed': StreamingChangedPayload;
	'app:updated': AppUpdatedPayload;
	'app:update-staged': UpdateStagedPayload;
	'browser:state-changed': BrowserState;
	'browser:tab-opened': BrowserTabArgs;
	'stats:resources-sampled': ResourceSample;
	'stats:workstream-running-changed': readonly WorkstreamRunning[];
}

export type EventChannel = keyof ContractEvents;

const EVENT_CHANNEL_INDEX: Readonly<Record<EventChannel, null>> = {
	'chat:agent-event': null,
	'chat:run-changes-captured': null,
	'chat:checkpoint-restored': null,
	'chat:session-renamed': null,
	'chat:mcp-server-changed': null,
	'repositories:workstream-created': null,
	'repositories:workstream-removed': null,
	'repositories:workstream-files-changed': null,
	'repositories:workstream-renamed': null,
	'repositories:workstream-install-status': null,
	'repositories:workstream-merge-conflicted': null,
	'repositories:clone-progress': null,
	'pull-requests:local-base-synced': null,
	'pull-requests:ship-changed': null,
	'jobs:run-changed': null,
	'jobs:definition-changed': null,
	'jobs:suggested': null,
	'app:close-requested': null,
	'app:scale-changed': null,
	'app:notification-opened': null,
	'app:menu-command-chosen': null,
	'app:streaming-changed': null,
	'app:updated': null,
	'app:update-staged': null,
	'browser:state-changed': null,
	'browser:tab-opened': null,
	'stats:resources-sampled': null,
	'stats:workstream-running-changed': null,
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

export const CHAT_MCP_SERVER_CHANGED_CHANNEL = 'chat:mcp-server-changed' satisfies EventChannel;

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

export const REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL =
	'repositories:workstream-merge-conflicted' satisfies EventChannel;

export const REPOSITORIES_CLONE_PROGRESS_CHANNEL =
	'repositories:clone-progress' satisfies EventChannel;

export const APP_CLOSE_REQUESTED_CHANNEL = 'app:close-requested' satisfies EventChannel;

export const APP_SCALE_CHANGED_CHANNEL = 'app:scale-changed' satisfies EventChannel;

export const APP_NOTIFICATION_OPENED_CHANNEL = 'app:notification-opened' satisfies EventChannel;

export const APP_MENU_COMMAND_CHOSEN_CHANNEL = 'app:menu-command-chosen' satisfies EventChannel;

export const APP_STREAMING_CHANGED_CHANNEL = 'app:streaming-changed' satisfies EventChannel;

export const APP_UPDATED_CHANNEL = 'app:updated' satisfies EventChannel;

export const APP_UPDATE_STAGED_CHANNEL = 'app:update-staged' satisfies EventChannel;

export const BROWSER_STATE_CHANGED_CHANNEL = 'browser:state-changed' satisfies EventChannel;

export const BROWSER_TAB_OPENED_CHANNEL = 'browser:tab-opened' satisfies EventChannel;

export const STATS_RESOURCES_SAMPLED_CHANNEL = 'stats:resources-sampled' satisfies EventChannel;

export const STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL =
	'stats:workstream-running-changed' satisfies EventChannel;

export const PULL_REQUESTS_SHIP_CHANGED_CHANNEL =
	'pull-requests:ship-changed' satisfies EventChannel;

export const JOBS_RUN_CHANGED_CHANNEL = 'jobs:run-changed' satisfies EventChannel;

export const JOBS_DEFINITION_CHANGED_CHANNEL = 'jobs:definition-changed' satisfies EventChannel;

export const JOBS_SUGGESTED_CHANNEL = 'jobs:suggested' satisfies EventChannel;
