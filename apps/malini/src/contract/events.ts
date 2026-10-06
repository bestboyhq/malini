import type { LiveEventEnvelope } from './agent';
import type { GitProjectRecord, GitWorkstreamRecord } from './repositories';
import type {
	RoutineChangedEvent,
	RoutineGatedRunChangedEvent,
	RoutineSuggestedEvent,
} from './routines';
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

export interface ContractEvents {
	'chat:agent-event': LiveEventEnvelope;
	'chat:run-changes-captured': RunChangesCapturedPayload;
	'chat:checkpoint-restored': CheckpointRestoredPayload;
	'repositories:workstream-created': WorktreeAddedPayload;
	'repositories:workstream-removed': WorktreeRemovedPayload;
	'repositories:workstream-files-changed': WorkstreamFilesChangedPayload;
	'repositories:workstream-renamed': WorkstreamRenamedPayload;
	'repositories:workstream-install-status': WorkstreamInstallStatusPayload;
	'repositories:clone-progress': CloneProgressPayload;
	'pull-requests:local-base-synced': LocalBaseSyncedPayload;
	'routines:suggested': RoutineSuggestedEvent;
	'routines:changed': RoutineChangedEvent;
	'routines:gated-run-changed': RoutineGatedRunChangedEvent;
	'app:close-requested': EmptyEventPayload;
	'app:scale-changed': EmptyEventPayload;
	'app:notification-opened': NotificationTarget;
}

export type EventChannel = keyof ContractEvents;

export const CHAT_AGENT_EVENT_CHANNEL = 'chat:agent-event' satisfies EventChannel;

export const CHAT_RUN_CHANGES_CAPTURED_CHANNEL = 'chat:run-changes-captured' satisfies EventChannel;

export const CHAT_CHECKPOINT_RESTORED_CHANNEL = 'chat:checkpoint-restored' satisfies EventChannel;

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

export const REPOSITORIES_CLONE_PROGRESS_CHANNEL =
	'repositories:clone-progress' satisfies EventChannel;

export const APP_CLOSE_REQUESTED_CHANNEL = 'app:close-requested' satisfies EventChannel;

export const APP_SCALE_CHANGED_CHANNEL = 'app:scale-changed' satisfies EventChannel;

export const APP_NOTIFICATION_OPENED_CHANNEL = 'app:notification-opened' satisfies EventChannel;

export const ROUTINES_SUGGESTED_CHANNEL = 'routines:suggested' satisfies EventChannel;

export const ROUTINES_CHANGED_CHANNEL = 'routines:changed' satisfies EventChannel;

export const ROUTINES_GATED_RUN_CHANGED_CHANNEL =
	'routines:gated-run-changed' satisfies EventChannel;
