// Generated from src/contract/events.ts and src/contract/event-catalog.ts by scripts/generate-contract-reference.mjs. Do not edit.

import type { ContractReference } from './events';

export const CONTRACT_REFERENCE: ContractReference = {
	events: [
		{
			channel: 'chat:agent-event',
			description:
				'Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order.',
			payloadType: 'LiveEventEnvelope',
			payload:
				'interface AgentEventEnvelope {\n\tsessionId: string;\n\trunId: string;\n\tseq: number;\n\tevent: Record<string, unknown>;\n}\n\ntype LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };',
		},
		{
			channel: 'chat:run-changes-captured',
			description:
				'Fires after an agent run that changed files finishes and Malini has recorded the diff of that run.',
			payloadType: 'RunChangesCapturedPayload',
			payload: 'interface RunChangesCapturedPayload {\n\tsessionId: string;\n\trunId: string;\n}',
		},
		{
			channel: 'chat:checkpoint-restored',
			description:
				"Fires after a workstream's files are restored to a chat checkpoint, rewinding the changes made after it.",
			payloadType: 'CheckpointRestoredPayload',
			payload:
				'interface CheckpointRestoredPayload {\n\tworkstreamId: string;\n\tcheckpointId: string;\n\tsessionId: string;\n}',
		},
		{
			channel: 'chat:session-renamed',
			description: 'Fires when a chat gets a new name, from the user or from the Name chats job.',
			payloadType: 'SessionRenamedPayload',
			payload:
				'interface SessionRenamedPayload {\n\tworkstreamId: string;\n\tsessionId: string;\n\tname: string;\n}',
		},
		{
			channel: 'repositories:workstream-created',
			description:
				'Fires when a new workstream exists: its git worktree is checked out and it is ready for chats.',
			payloadType: 'WorktreeAddedPayload',
			payload:
				'interface GitProjectRecord {\n\tid: string;\n\tname: string;\n\trepoPath: string;\n\tdefaultBranch: string;\n\tcreatedAt: string;\n}\n\ninterface GitWorkstreamRecord {\n\tid: string;\n\tprojectId: string;\n\tname: string;\n\tpath: string;\n\tbranch: string;\n\tbaseBranch: string;\n\tstatus: string;\n\tcreatedAt: string;\n}\n\ninterface WorktreeAddedPayload {\n\tworkstreamId: string;\n\tproject: GitProjectRecord;\n\tworkstream: GitWorkstreamRecord;\n}',
		},
		{
			channel: 'repositories:workstream-removed',
			description:
				'Fires when a workstream leaves the sidebar, with `archived` set when it was archived and `deleted` set when it was deleted.',
			payloadType: 'WorktreeRemovedPayload',
			payload:
				'interface WorktreeRemovedPayload {\n\tworkstreamId: string;\n\tworktreePath: string;\n\tarchived?: true;\n\tdeleted?: true;\n}',
		},
		{
			channel: 'repositories:workstream-files-changed',
			description:
				"Fires when files change in a workstream's checkout, with the changed paths, or `null` paths when Malini could not tell which files changed.",
			payloadType: 'WorkstreamFilesChangedPayload',
			payload:
				'interface WorkstreamFilesChangedPayload {\n\tworkstreamId: string;\n\tchangedAt: string;\n\tpaths: string[] | null;\n}',
		},
		{
			channel: 'repositories:workstream-renamed',
			description: 'Fires when a workstream gets a new name.',
			payloadType: 'WorkstreamRenamedPayload',
			payload: 'interface WorkstreamRenamedPayload {\n\tworkstreamId: string;\n\tname: string;\n}',
		},
		{
			channel: 'repositories:workstream-install-status',
			description:
				"Fires as a new workstream's dependency install moves through its states: running, succeeded, failed, skipped or aborted.",
			payloadType: 'WorkstreamInstallStatusPayload',
			payload:
				"type InstallStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';\n\ntype InstallSkipReason = 'already-installed' | 'no-manifest' | 'unrecognized-project';\n\ninterface WorkstreamInstallStatusPayload {\n\ttype: 'repositories:workstream-install-status';\n\tworkstreamId: string;\n\tstatus: InstallStatus;\n\tcommand?: string;\n\treason?: InstallSkipReason;\n\tdetail?: string;\n\tdurationMs?: number;\n\texitCode?: number;\n}",
		},
		{
			channel: 'repositories:clone-progress',
			description:
				'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done.',
			payloadType: 'CloneProgressPayload',
			payload:
				"interface CloneProgressPayload {\n\trepo_id: string;\n\tstage: 'fetch' | 'checkout' | 'done';\n\tfraction: number;\n}",
		},
		{
			channel: 'pull-requests:local-base-synced',
			description:
				"Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.",
			payloadType: 'LocalBaseSyncedPayload',
			payload:
				"interface LocalBaseSyncedPayload {\n\tworkstreamId: string | null;\n\tcheckout: string;\n\tbranch: string;\n\toutcome: 'advanced' | 'diverged' | 'failed';\n\tdetail?: string;\n}",
		},
		{
			channel: 'pull-requests:ship-changed',
			description:
				"Fires whenever a workstream's shipping state changes: its pull request phase, the merge queue step, or a reason it needs you.",
			payloadType: 'ShipChangedEvent',
			payload:
				"type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';\n\ntype ShipStep =\n\t| 'waiting-for-agent'\n\t| 'opening-draft'\n\t| 'pushing'\n\t| 'marking-ready'\n\t| 'updating-branch'\n\t| 'updating-from-main'\n\t| 'fixing-checks'\n\t| 'addressing-review'\n\t| 'waiting-for-checks'\n\t| 'waiting-for-review'\n\t| 'waiting-for-github'\n\t| 'merging'\n\t| 'archiving';\n\ntype ShipNeedsYouReason =\n\t| 'reply-to-reviewer'\n\t| 'fix-gave-up'\n\t| 'merge-not-permitted'\n\t| 'pull-request-closed'\n\t| 'github-reconnect'\n\t| 'operation-in-progress';\n\ntype ShipNeedsYou = Readonly<{\n\treason: ShipNeedsYouReason;\n\tdetail: string;\n\tjobRunId: string | null;\n}>;\n\ntype ShipStateRecord = Readonly<{\n\tworkstreamId: string;\n\tphase: ShipPhase;\n\tstep: ShipStep | null;\n\tpullRequestNumber: number | null;\n\tpullRequestUrl: string | null;\n\tneedsYou: ShipNeedsYou | null;\n\tqueuedAt: string | null;\n\tattempts: number;\n\tactiveJobRunId: string | null;\n\tlastError: string | null;\n\tnextAttemptAt: string | null;\n\tupdatedAt: string;\n}>;\n\ntype ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;\n\ntype ShipChangedEvent = Readonly<{\n\tworkstreamId: string;\n\tstate: ShipStateRecord | null;\n\tmerged?: ShipMerged;\n}>;",
		},
		{
			channel: 'jobs:run-changed',
			description:
				'Fires whenever a job run is queued, starts, needs you, or finishes as succeeded, failed or cancelled.',
			payloadType: 'JobRunChangedEvent',
			payload:
				"type JobRunOrigin = 'merge-queue' | 'manual' | 'routine';\n\ntype JobRunStatus =\n\t'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';\n\ntype JobRunRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\ttitle: string;\n\tworkstreamId: string | null;\n\trepositoryId: string | null;\n\tsessionId: string | null;\n\tagentRunId: string | null;\n\torigin: JobRunOrigin;\n\tstatus: JobRunStatus;\n\tdetail: string | null;\n\tchatSessionId: string | null;\n\tchatAfterRunId: string | null;\n\tcreatedAt: string;\n\tstartedAt: string | null;\n\tfinishedAt: string | null;\n}>;\n\ntype JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;",
		},
		{
			channel: 'jobs:definition-changed',
			description:
				'Fires when a job is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.',
			payloadType: 'JobDefinitionChangedEvent',
			payload:
				"type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';\n\ntype JobRunsIn = 'workstream' | 'new-workstream';\n\ntype JobOutput = 'none' | 'draft' | 'merge';\n\ntype JobBuiltin =\n\t| 'name-chats'\n\t| 'name-services'\n\t| 'fix-checks'\n\t| 'update-from-main'\n\t| 'address-review'\n\t| 'check-compatibility'\n\t| 'update-docs';\n\ntype JobDefinitionRecord = Readonly<{\n\tid: string;\n\tname: string;\n\tinstructions: string;\n\tmodel: string;\n\teffort: AgentReasoningEffort;\n\trunsIn: JobRunsIn;\n\toutput: JobOutput;\n\tskillPresetId: string | null;\n\tbuiltin: JobBuiltin | null;\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype JobDefinitionChangedEvent = Readonly<{\n\tdefinitionId: string;\n\tdefinition: JobDefinitionRecord | null;\n}>;",
		},
		{
			channel: 'routines:suggested',
			description:
				'Fires when Malini notices a prompt you keep repeating and suggests turning it into a routine.',
			payloadType: 'RoutineSuggestedEvent',
			payload:
				"type RoutineSuggestionStatus = 'open' | 'dismissed' | 'accepted';\n\ntype RoutinePromptEvidence = Readonly<{\n\tkind: 'prompt';\n\ttext: string;\n\trunId?: string;\n\tsessionId?: string;\n\tworkstreamId?: string;\n\tsubmittedAt?: string;\n}>;\n\ntype RoutineSuggestionRecord = Readonly<{\n\tid: string;\n\tclusterKey: string;\n\tstatus: RoutineSuggestionStatus;\n\tevidence: readonly RoutinePromptEvidence[];\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype RoutineSuggestedEvent = Readonly<{\n\tsuggestion: RoutineSuggestionRecord;\n}>;",
		},
		{
			channel: 'routines:changed',
			description:
				'Fires when a routine is created, updated, promoted, demoted or deleted; `routine` is `null` after a delete.',
			payloadType: 'RoutineChangedEvent',
			payload:
				"type RoutineChange = 'created' | 'updated' | 'promoted' | 'demoted' | 'deleted';\n\ntype RoutineStatus = 'draft' | 'candidate' | 'routine';\n\ntype RoutineOrigin = 'user' | 'suggested';\n\ntype RoutineJsonValue =\n\t| string\n\t| number\n\t| boolean\n\t| null\n\t| readonly RoutineJsonValue[]\n\t| { readonly [key: string]: RoutineJsonValue };\n\ntype RoutineWorkflowRun = Readonly<{\n\tworkflow: string;\n\tinput: Readonly<Record<string, RoutineJsonValue>>;\n}>;\n\ntype RoutineCommandRun = Readonly<{\n\tcommand: string;\n\targs: readonly RoutineJsonValue[];\n}>;\n\ntype RoutineJobRun = Readonly<{ job: string }>;\n\ntype RoutineRun = RoutineWorkflowRun | RoutineCommandRun | RoutineJobRun;\n\ntype RoutinePromptEvidence = Readonly<{\n\tkind: 'prompt';\n\ttext: string;\n\trunId?: string;\n\tsessionId?: string;\n\tworkstreamId?: string;\n\tsubmittedAt?: string;\n}>;\n\ntype RoutineRunEvidence = Readonly<{\n\tkind: 'run';\n\trunId: string;\n\tsessionId?: string;\n\tworkstreamId?: string;\n\tsummary?: string;\n}>;\n\ntype RoutineEvidence = RoutinePromptEvidence | RoutineRunEvidence;\n\ntype RoutineRecord = Readonly<{\n\tid: string;\n\tstatus: RoutineStatus;\n\torigin: RoutineOrigin;\n\tlabel: string;\n\twhen: string;\n\tsteps: readonly RoutineRun[];\n\tevidence: readonly RoutineEvidence[];\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype RoutineChangedEvent = Readonly<{\n\troutineId: string;\n\tchange: RoutineChange;\n\troutine: RoutineRecord | null;\n}>;",
		},
		{
			channel: 'routines:gated-run-changed',
			description:
				'Fires when a routine run waits for your confirmation, and again when you confirm or reject it.',
			payloadType: 'RoutineGatedRunChangedEvent',
			payload:
				"type RoutineJsonValue =\n\t| string\n\t| number\n\t| boolean\n\t| null\n\t| readonly RoutineJsonValue[]\n\t| { readonly [key: string]: RoutineJsonValue };\n\ntype RoutineGatedRunState = 'pending' | 'confirmed' | 'rejected';\n\ntype RoutineGatedRunRecord = Readonly<{\n\tid: string;\n\troutineId: string;\n\tworkstreamId: string;\n\trunKey: string;\n\tevent: string;\n\tpayload: RoutineJsonValue;\n\tstate: RoutineGatedRunState;\n\tcreatedAt: string;\n\tdecidedAt: string | null;\n}>;\n\ntype RoutineGatedRunChangedEvent = Readonly<{\n\tgatedRun: RoutineGatedRunRecord;\n}>;",
		},
		{
			channel: 'app:close-requested',
			description:
				'Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.',
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
		},
		{
			channel: 'app:scale-changed',
			description:
				'Fires when the interface scale or the display the window sits on changes, so layouts can measure again.',
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
		},
		{
			channel: 'app:notification-opened',
			description: 'Fires when you click a Malini notification, with the chat it points to.',
			payloadType: 'NotificationTarget',
			payload: 'type NotificationTarget = Readonly<{ workstreamId: string; sessionId: string }>;',
		},
		{
			channel: 'app:connect-repository-requested',
			description:
				"Fires when you pick Open Folder… or Clone Repository… from Malini's menu bar icon, with which one you picked.",
			payloadType: 'ConnectRepositoryRequest',
			payload: "type ConnectRepositoryRequest = Readonly<{ via: 'folder' | 'clone' }>;",
		},
		{
			channel: 'app:streaming-changed',
			description:
				'Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.',
			payloadType: 'StreamingChangedPayload',
			payload: 'type StreamingChangedPayload = Readonly<{ streaming: boolean }>;',
		},
		{
			channel: 'app:updated',
			description:
				'Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed.',
			payloadType: 'AppUpdatedPayload',
			payload:
				'type ContractPayloadChange = Readonly<{ channel: string; before: string; after: string }>;\n\ntype ContractChanges = Readonly<{\n\tadded: readonly string[];\n\tremoved: readonly string[];\n\tchanged: readonly ContractPayloadChange[];\n}>;\n\ntype AppUpdatedPayload = Readonly<{ from: string; to: string; changes: ContractChanges }>;',
		},
		{
			channel: 'app:update-staged',
			description:
				'Fires when a new Malini version has downloaded and installs on the next restart, with that version.',
			payloadType: 'UpdateStagedPayload',
			payload: 'type UpdateStagedPayload = Readonly<{ version: string }>;',
		},
		{
			channel: 'browser:state-changed',
			description:
				"Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure.",
			payloadType: 'BrowserState',
			payload:
				'type BrowserState = Readonly<{\n\tworkstreamId: string;\n\ttabId: string;\n\turl: string;\n\ttitle: string;\n\tfavicon: string | null;\n\tloading: boolean;\n\tcanGoBack: boolean;\n\tcanGoForward: boolean;\n\tfailure: string | null;\n}>;',
		},
		{
			channel: 'browser:tab-opened',
			description:
				'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
			payloadType: 'BrowserTabArgs',
			payload: 'type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;',
		},
		{
			channel: 'stats:resources-sampled',
			description:
				'Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use.',
			payloadType: 'ResourceSample',
			payload:
				"type ResourceKind = 'malini' | 'browser' | 'agents' | 'tools' | 'docker';\n\ntype ResourceUsage = Readonly<{\n\tkind: ResourceKind;\n\tmemoryBytes: number;\n\tcpuPercent: number;\n\tprocesses: number;\n}>;\n\ntype ResourceSample = Readonly<{\n\tsampledAt: number;\n\tmemoryBytes: number;\n\tcpuPercent: number;\n\tprocesses: number;\n\tusage: readonly ResourceUsage[];\n}>;",
		},
		{
			channel: 'stats:workstream-running-changed',
			description:
				'Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers.',
			payloadType: 'readonly WorkstreamRunning[]',
			payload:
				"type RunningItemOrigin = 'agent' | 'docker';\n\ntype RunningItemKind = 'service' | 'task';\n\ntype RunningItem = Readonly<{\n\tid: string;\n\torigin: RunningItemOrigin;\n\tname: string;\n\tkind: RunningItemKind;\n\tdetail: string;\n\tgroup: string | null;\n\tstartedAt: number;\n\tports: readonly number[];\n}>;\n\ntype WorkstreamTurn = Readonly<{\n\tendedAt: number;\n\toutcome: string | null;\n\tneed: string | null;\n}>;\n\ntype WorkstreamRunning = Readonly<{\n\tworkstreamId: string;\n\titems: readonly RunningItem[];\n\tbehind: readonly string[];\n\tturn: WorkstreamTurn | null;\n}>;",
		},
	],
};
