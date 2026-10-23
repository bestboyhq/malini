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
			channel: 'chat:mcp-server-changed',
			description:
				'Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.',
			payloadType: 'McpServerReport',
			payload:
				'type McpServerReport = Readonly<{\n\tname: string;\n\tstatus: string;\n\terror?: string;\n\tsource?: string;\n\ttoolCount?: number;\n}>;',
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
			channel: 'repositories:workstream-merge-conflicted',
			description:
				"Fires when merging a workstream's base branch into it stops on conflicts, with the base branch and the conflicted files.",
			payloadType: 'WorkstreamMergeConflictedPayload',
			payload:
				'interface WorkstreamMergeConflictedPayload {\n\tworkstreamId: string;\n\tbaseBranch: string;\n\tconflictedPaths: string[];\n}',
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
			channel: 'repositories:changed',
			description:
				'Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.',
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
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
				"type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';\n\ntype ShipStep =\n\t| 'waiting-for-agent'\n\t| 'opening-draft'\n\t| 'pushing'\n\t| 'marking-ready'\n\t| 'updating-branch'\n\t| 'updating-from-main'\n\t| 'resolving-conflicts'\n\t| 'fixing-checks'\n\t| 'addressing-review'\n\t| 'waiting-for-checks'\n\t| 'waiting-for-review'\n\t| 'waiting-for-github'\n\t| 'merging'\n\t| 'archiving';\n\ntype ShipNeedsYouReason =\n\t| 'reply-to-reviewer'\n\t| 'fix-gave-up'\n\t| 'merge-not-permitted'\n\t| 'pull-request-closed'\n\t| 'github-reconnect'\n\t| 'operation-in-progress';\n\ntype ShipNeedsYou = Readonly<{\n\treason: ShipNeedsYouReason;\n\tdetail: string;\n\tjobRunId: string | null;\n}>;\n\ntype ShipStateRecord = Readonly<{\n\tworkstreamId: string;\n\tphase: ShipPhase;\n\tstep: ShipStep | null;\n\tpullRequestNumber: number | null;\n\tpullRequestUrl: string | null;\n\tneedsYou: ShipNeedsYou | null;\n\tqueuedAt: string | null;\n\tattempts: number;\n\tactiveJobRunId: string | null;\n\tlastError: string | null;\n\tnextAttemptAt: string | null;\n\tupdatedAt: string;\n}>;\n\ntype ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;\n\ntype ShipChangedEvent = Readonly<{\n\tworkstreamId: string;\n\tstate: ShipStateRecord | null;\n\tmerged?: ShipMerged;\n}>;",
		},
		{
			channel: 'jobs:run-changed',
			description:
				'Fires whenever a job run waits for you, is queued, starts, needs you, or finishes as succeeded, failed or cancelled.',
			payloadType: 'JobRunChangedEvent',
			payload:
				"type JobRunOrigin = 'merge-queue' | 'manual' | 'trigger' | 'then';\n\ntype JobRunStatus =\n\t'waiting' | 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';\n\ntype JobRunRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\ttitle: string;\n\tworkstreamId: string | null;\n\trepositoryId: string | null;\n\tsessionId: string | null;\n\tagentRunId: string | null;\n\torigin: JobRunOrigin;\n\tstatus: JobRunStatus;\n\tdetail: string | null;\n\tparentRunId: string | null;\n\tchatSessionId: string | null;\n\tchatAfterRunId: string | null;\n\tcreatedAt: string;\n\tstartedAt: string | null;\n\tfinishedAt: string | null;\n}>;\n\ntype JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;",
		},
		{
			channel: 'jobs:definition-changed',
			description:
				'Fires when a job is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.',
			payloadType: 'JobDefinitionChangedEvent',
			payload:
				"type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';\n\ntype JobRunsIn = 'workstream' | 'new-workstream';\n\ntype JobBuiltin =\n\t| 'name-chats'\n\t| 'name-services'\n\t| 'fix-checks'\n\t| 'update-from-main'\n\t| 'resolve-conflicts'\n\t| 'address-review'\n\t| 'check-compatibility'\n\t| 'update-docs'\n\t| 'open-draft'\n\t| 'merge';\n\ntype JobRunMode = 'off' | 'ask' | 'auto';\n\ntype JobTrigger = Readonly<{ when: string; mode: JobRunMode }>;\n\ntype JobDefinitionRecord = Readonly<{\n\tid: string;\n\tname: string;\n\tinstructions: string;\n\tmodel: string;\n\teffort: AgentReasoningEffort;\n\trunsIn: JobRunsIn;\n\tskills: readonly string[];\n\tbuiltin: JobBuiltin | null;\n\ttrigger: JobTrigger | null;\n\tthenJobId: string | null;\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype JobDefinitionChangedEvent = Readonly<{\n\tdefinitionId: string;\n\tdefinition: JobDefinitionRecord | null;\n}>;",
		},
		{
			channel: 'jobs:suggested',
			description:
				'Fires when Malini notices a prompt you keep repeating and suggests turning it into a job.',
			payloadType: 'JobSuggestedEvent',
			payload:
				"type JobSuggestionStatus = 'open' | 'dismissed' | 'accepted';\n\ntype JobPromptEvidence = Readonly<{\n\ttext: string;\n\trunId?: string;\n\tsessionId?: string;\n\tworkstreamId?: string;\n\tsubmittedAt?: string;\n}>;\n\ntype JobSuggestionRecord = Readonly<{\n\tid: string;\n\tclusterKey: string;\n\tstatus: JobSuggestionStatus;\n\tevidence: readonly JobPromptEvidence[];\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype JobSuggestedEvent = Readonly<{ suggestion: JobSuggestionRecord }>;",
		},
		{
			channel: 'jobs:experiment-changed',
			description:
				"Fires when an experiment on a job's Improve page finishes replaying the job's recent tasks, with every result.",
			payloadType: 'JobExperimentChangedEvent',
			payload:
				'type JobExperimentResult = Readonly<{\n\toutputId: string;\n\toutput: string | null;\n\terror: string | null;\n}>;\n\ntype JobExperimentRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\tname: string;\n\tmodel: string;\n\tinstructions: string;\n\tcurrent: boolean;\n\trunning: boolean;\n\tresults: readonly JobExperimentResult[];\n\tcreatedAt: string;\n}>;\n\ntype JobExperimentChangedEvent = Readonly<{ experiment: JobExperimentRecord }>;',
		},
		{
			channel: 'jobs:agent-action-changed',
			description:
				"Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome.",
			payloadType: 'AgentActionChangedEvent',
			payload:
				"type AgentActionStatus = 'running' | 'succeeded' | 'failed' | 'denied';\n\ntype AgentActionApproval = 'not-needed' | 'allowed' | 'always-allowed' | 'denied';\n\ntype AgentActionRecord = Readonly<{\n\tid: string;\n\tsessionId: string;\n\trunId: string;\n\tworkstreamId: string | null;\n\ttool: string;\n\tinput: Readonly<Record<string, unknown>>;\n\tstatus: AgentActionStatus;\n\tapproval: AgentActionApproval;\n\toutput: string | null;\n\tstartedAt: string;\n\tfinishedAt: string | null;\n}>;\n\ntype AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;",
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
			channel: 'app:menu-command-chosen',
			description:
				"Fires when you pick New Workstream, New Chat, Open Folder…, Clone Repository… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.",
			payloadType: 'MenuCommandChosen',
			payload:
				"type MenuCommand =\n\t'new-workstream' | 'new-chat' | 'open-folder' | 'clone-repository' | 'settings';\n\ntype MenuCommandChosen = Readonly<{ command: MenuCommand }>;",
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
