// Generated from src/contract/events.ts and src/contract/event-catalog.ts by scripts/generate-contract-reference.mjs. Do not edit.

import type { ContractReference } from './events';

export const CONTRACT_REFERENCE: ContractReference = {
	events: [
		{
			channel: 'chat:agent-event',
			description:
				'Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order. Malini does not keep it in its event log.',
			facts: ['sessionId', 'runId', 'seq', 'emittedAt', 'event.type'],
			payloadType: 'LiveEventEnvelope',
			payload:
				'interface AgentEventEnvelope {\n\tsessionId: string;\n\trunId: string;\n\tseq: number;\n\tevent: Record<string, unknown>;\n\temittedAt?: string;\n}\n\ntype LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };',
		},
		{
			channel: 'chat:run-changes-captured',
			description:
				'Fires after an agent run that changed files finishes and Malini has recorded the diff of that run.',
			facts: ['sessionId', 'runId'],
			payloadType: 'RunChangesCapturedPayload',
			payload: 'interface RunChangesCapturedPayload {\n\tsessionId: string;\n\trunId: string;\n}',
		},
		{
			channel: 'chat:checkpoint-restored',
			description:
				"Fires after a workstream's files are restored to a chat checkpoint, rewinding the changes made after it.",
			facts: ['workstreamId', 'checkpointId', 'sessionId'],
			payloadType: 'CheckpointRestoredPayload',
			payload:
				'interface CheckpointRestoredPayload {\n\tworkstreamId: string;\n\tcheckpointId: string;\n\tsessionId: string;\n}',
		},
		{
			channel: 'chat:session-renamed',
			description:
				'Fires when a chat gets a new name, from the user or from the Name chats automation.',
			facts: ['workstreamId', 'sessionId'],
			payloadType: 'SessionRenamedPayload',
			payload:
				'interface SessionRenamedPayload {\n\tworkstreamId: string;\n\tsessionId: string;\n\tname: string;\n}',
		},
		{
			channel: 'chat:turn-finished',
			description:
				"Fires when a turn of one of your chats ends, not an automation's or a thread's you started from a page, with how it ended and the `Outcome:` and `Needs:` lines of its report; `needs` is `null` when the turn needs nothing from you. A turn that ends while only background commands run fires it at once, naming them in `backgroundCommands`, and fires it again when the agent goes on after them and ends; `backgroundCommands` is `null` once the run itself ended. A turn that Malini quitting, an agent restart or a reset cut short ends `interrupted`, not `failed`, so `where status is failed` skips it.",
			facts: ['workstreamId', 'sessionId', 'runId', 'status'],
			payloadType: 'ChatTurnFinishedPayload',
			payload:
				"type RunEnding = 'succeeded' | 'failed' | 'cancelled' | 'interrupted';\n\ntype ChatTurnFinishedStatus = RunEnding;\n\ninterface ChatTurnFinishedPayload {\n\tworkstreamId: string;\n\tsessionId: string;\n\trunId: string;\n\tstatus: ChatTurnFinishedStatus;\n\toutcome: string | null;\n\tneeds: string | null;\n\tbackgroundCommands: readonly string[] | null;\n}",
		},
		{
			channel: 'chat:delivery-changed',
			description:
				'Fires when Malini holds a prompt for a chat that is on a turn, delivers it once that turn ends, or cannot deliver it, such as a prompt one chat sends the chat of a workstream it started. Malini does not keep it in its event log.',
			facts: [
				'delivery.id',
				'delivery.sessionId',
				'delivery.fromSessionId',
				'delivery.status',
				'delivery.runId',
				'delivery.createdAt',
				'delivery.deliveredAt',
			],
			payloadType: 'ChatDeliveryChangedEvent',
			payload:
				"type ChatDeliveryStatus = 'waiting' | 'delivered' | 'failed';\n\ntype ChatDelivery = Readonly<{\n\tid: string;\n\tsessionId: string;\n\tfromSessionId: string | null;\n\tstatus: ChatDeliveryStatus;\n\trunId: string | null;\n\tdetail: string | null;\n\tcreatedAt: string;\n\tdeliveredAt: string | null;\n}>;\n\ntype ChatDeliveryChangedEvent = Readonly<{ delivery: ChatDelivery }>;",
		},
		{
			channel: 'chat:mcp-server-changed',
			description:
				'Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.',
			facts: ['name', 'status', 'source', 'toolCount'],
			payloadType: 'McpServerReport',
			payload:
				'type McpServerReport = Readonly<{\n\tname: string;\n\tstatus: string;\n\terror?: string;\n\tsource?: string;\n\ttoolCount?: number;\n}>;',
		},
		{
			channel: 'chat:mcp-servers-listed',
			description:
				'Fires while the MCP servers page is open, each time the Claude Code that watches a folder sees a server connect, fail, or change, with every server of that folder and whether any is still connecting. Malini does not keep it in its event log.',
			facts: ['workstreamId', 'settled'],
			payloadType: 'McpServerListing',
			payload:
				'type McpServerReport = Readonly<{\n\tname: string;\n\tstatus: string;\n\terror?: string;\n\tsource?: string;\n\ttoolCount?: number;\n}>;\n\ntype McpServerListing = Readonly<{\n\tworkstreamId: string | null;\n\tservers: readonly McpServerReport[];\n\tsettled: boolean;\n\terror?: string;\n}>;',
		},
		{
			channel: 'chat:shell-run-changed',
			description:
				"Fires when you run a command from a code block's Run button, while it prints, and when it ends, with the command, `anchor`: the message and the code block in it it ran from, its output so far, and `state`: `running`, `exited` with its `exitCode`, `stopped`, or `failed` when it could not start. Malini does not keep it in its event log.",
			facts: [
				'id',
				'workstreamId',
				'sessionId',
				'anchor.message',
				'anchor.block',
				'state',
				'exitCode',
				'startedAt',
				'finishedAt',
			],
			payloadType: 'ShellRun',
			payload:
				"type ShellRunAnchor = Readonly<{ message: string; block: number }>;\n\ntype ShellRunState = 'running' | 'exited' | 'stopped' | 'failed';\n\ntype ShellRun = Readonly<{\n\tid: string;\n\tworkstreamId: string;\n\tsessionId: string;\n\tanchor: ShellRunAnchor;\n\tcommand: string;\n\tstate: ShellRunState;\n\texitCode: number | null;\n\toutput: string;\n\tstartedAt: string;\n\tfinishedAt: string | null;\n}>;",
		},
		{
			channel: 'repositories:workstream-created',
			description:
				'Fires when a new workstream exists: its git worktree is checked out and it is ready for chats. `workstream.startedBy` is the id of the workstream whose chat started it.',
			facts: [
				'workstreamId',
				'project.id',
				'project.name',
				'project.defaultBranch',
				'workstream.id',
				'workstream.projectId',
				'workstream.path',
				'workstream.branch',
				'workstream.baseBranch',
				'workstream.status',
				'workstream.createdAt',
				'workstream.startedBy',
			],
			payloadType: 'WorktreeAddedPayload',
			payload:
				'interface GitProjectRecord {\n\tid: string;\n\tname: string;\n\trepoPath: string;\n\tdefaultBranch: string;\n\tcreatedAt: string;\n}\n\ninterface GitWorkstreamRecord {\n\tid: string;\n\tprojectId: string;\n\tname: string;\n\tpath: string;\n\tbranch: string;\n\tbaseBranch: string;\n\tstatus: string;\n\tcreatedAt: string;\n\tstartedBy: string | null;\n}\n\ninterface WorktreeAddedPayload {\n\tworkstreamId: string;\n\tproject: GitProjectRecord;\n\tworkstream: GitWorkstreamRecord;\n}',
		},
		{
			channel: 'repositories:workstream-removed',
			description:
				'Fires when a workstream leaves the sidebar, with `archived` set when it was archived and `deleted` set when it was deleted.',
			facts: ['workstreamId', 'worktreePath', 'archived', 'deleted'],
			payloadType: 'WorktreeRemovedPayload',
			payload:
				'interface WorktreeRemovedPayload {\n\tworkstreamId: string;\n\tworktreePath: string;\n\tarchived?: true;\n\tdeleted?: true;\n}',
		},
		{
			channel: 'repositories:workstream-files-changed',
			description:
				"Fires when files change in a workstream's checkout, with the changed paths, or `null` paths when Malini could not tell which files changed.",
			facts: ['workstreamId', 'changedAt', 'paths'],
			payloadType: 'WorkstreamFilesChangedPayload',
			payload:
				'interface WorkstreamFilesChangedPayload {\n\tworkstreamId: string;\n\tchangedAt: string;\n\tpaths: string[] | null;\n}',
		},
		{
			channel: 'repositories:workstream-renamed',
			description: 'Fires when a workstream gets a new name.',
			facts: ['workstreamId'],
			payloadType: 'WorkstreamRenamedPayload',
			payload: 'interface WorkstreamRenamedPayload {\n\tworkstreamId: string;\n\tname: string;\n}',
		},
		{
			channel: 'repositories:workstream-install-status',
			description:
				"Fires as a new workstream's dependency install moves through its states: running, succeeded, failed, skipped or aborted.",
			facts: ['type', 'workstreamId', 'status', 'command', 'reason', 'durationMs', 'exitCode'],
			payloadType: 'WorkstreamInstallStatusPayload',
			payload:
				"type InstallStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';\n\ntype InstallSkipReason = 'already-installed' | 'no-manifest' | 'unrecognized-project';\n\ninterface WorkstreamInstallStatusPayload {\n\ttype: 'repositories:workstream-install-status';\n\tworkstreamId: string;\n\tstatus: InstallStatus;\n\tcommand?: string;\n\treason?: InstallSkipReason;\n\tdetail?: string;\n\tdurationMs?: number;\n\texitCode?: number;\n}",
		},
		{
			channel: 'repositories:workstream-setup-status',
			description:
				'Fires when Malini starts setting up a workstream an agent or an automation started, updating its base branch and installing its dependencies, and again with `done` once it finishes.',
			facts: ['workstreamId', 'status'],
			payloadType: 'WorkstreamSetupStatusPayload',
			payload:
				"interface WorkstreamSetupStatusPayload {\n\tworkstreamId: string;\n\tstatus: 'running' | 'done';\n}",
		},
		{
			channel: 'repositories:workstream-merge-conflicted',
			description:
				"Fires when a merge in a workstream stops on conflicts, whoever started it, with the workstream's base branch and the conflicted files.",
			facts: ['workstreamId', 'baseBranch', 'conflictedPaths'],
			payloadType: 'WorkstreamMergeConflictedPayload',
			payload:
				'interface WorkstreamMergeConflictedPayload {\n\tworkstreamId: string;\n\tbaseBranch: string;\n\tconflictedPaths: string[];\n}',
		},
		{
			channel: 'repositories:workstream-base-overlapped',
			description:
				"Fires when a workstream's base branch has commits the workstream lacks, once for each pair of `head` and `baseHead` commits. Malini looks after each commit in the workstream, each time it fetches the base branch, every five minutes, and right after its merge queue lands a pull request; once the base branch moves, it waits until it has held still for 30 seconds, and it looks only while no agent works there, nothing is left uncommitted and no service the workstream started runs. `overlapping` says whether those commits conflict with the workstream or change files it changed too; it fires with `overlapping` false only for a workstream someone worked in during the last 7 days. `conflicts` says whether merging the base branch would stop on conflicts, with the `conflictedPaths`; `overlappingPaths` are the files both sides changed, leaving out lockfiles, changelogs and files `.gitattributes` marks `linguist-generated` unless they conflict. A workstream with no commits of its own fires nothing: it fast-forwards to the base branch when it started from it, and stays where it started when it started from a tag or a commit. Update from main runs on it where `overlapping` is true, or on every one once you pick Always.",
			facts: [
				'workstreamId',
				'baseBranch',
				'head',
				'baseHead',
				'behind',
				'overlapping',
				'conflicts',
				'conflictedPaths',
				'overlappingPaths',
			],
			payloadType: 'WorkstreamBaseOverlappedPayload',
			payload:
				'interface WorkstreamBaseOverlappedPayload {\n\tworkstreamId: string;\n\tbaseBranch: string;\n\thead: string;\n\tbaseHead: string;\n\tbehind: number;\n\toverlapping: boolean;\n\tconflicts: boolean;\n\tconflictedPaths: string[];\n\toverlappingPaths: string[];\n}',
		},
		{
			channel: 'repositories:workstream-head-moved',
			description:
				"Fires when the commit a workstream's checkout points to changes, whoever moved it: a commit, a merge, a pull or a reset, with the branch, or `null` when the checkout is detached, and the commits before and after; `previousHead` is `null` for the first commit of a new branch.",
			facts: ['workstreamId', 'branch', 'head', 'previousHead'],
			payloadType: 'WorkstreamHeadMovedPayload',
			payload:
				'interface WorkstreamHeadMovedPayload {\n\tworkstreamId: string;\n\tbranch: string | null;\n\thead: string;\n\tpreviousHead: string | null;\n}',
		},
		{
			channel: 'repositories:workstream-pushed',
			description:
				"Fires when a workstream's branch on `origin` moves, after a push or a fetch that brings in someone else's push, with the commit it points to now.",
			facts: ['workstreamId', 'branch', 'head'],
			payloadType: 'WorkstreamPushedPayload',
			payload:
				'interface WorkstreamPushedPayload {\n\tworkstreamId: string;\n\tbranch: string;\n\thead: string;\n}',
		},
		{
			channel: 'repositories:clone-progress',
			description:
				'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done. Malini does not keep it in its event log.',
			facts: ['repo_id', 'stage', 'fraction'],
			payloadType: 'CloneProgressPayload',
			payload:
				"interface CloneProgressPayload {\n\trepo_id: string;\n\tstage: 'fetch' | 'checkout' | 'done';\n\tfraction: number;\n}",
		},
		{
			channel: 'repositories:github-cli-install-progress',
			description:
				'Fires repeatedly while Malini downloads the GitHub CLI after you press Install, with the bytes received and the size when known, and once more when the download ends. Malini does not keep it in its event log.',
			facts: ['received', 'total'],
			payloadType: 'InstallProgressPayload',
			payload:
				'interface InstallProgressPayload {\n\treceived: number;\n\ttotal: number | null;\n}',
		},
		{
			channel: 'repositories:changed',
			description:
				'Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.',
			facts: [],
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
		},
		{
			channel: 'repositories:github-reach-changed',
			description:
				"Fires when GitHub stops or starts answering Malini's `gh` calls, with `reach`: `ok`, `unreachable` when GitHub does not respond, `down` when GitHub answers with a server error, or `rate-limited` when GitHub limits your account.",
			facts: ['reach'],
			payloadType: 'GithubReachChangedPayload',
			payload:
				"type GithubFailure = 'unreachable' | 'down' | 'rate-limited';\n\ntype GithubReach = 'ok' | GithubFailure;\n\ntype GithubReachChangedPayload = Readonly<{ reach: GithubReach }>;",
		},
		{
			channel: 'providers:claude-code-install-progress',
			description:
				'Fires repeatedly while Malini downloads Claude Code after you press Install, with the bytes received and the size, and once more when the download ends. Malini does not keep it in its event log.',
			facts: ['received', 'total'],
			payloadType: 'InstallProgressPayload',
			payload:
				'interface InstallProgressPayload {\n\treceived: number;\n\ttotal: number | null;\n}',
		},
		{
			channel: 'pull-requests:local-base-synced',
			description:
				"Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.",
			facts: ['workstreamId', 'checkout', 'branch', 'outcome'],
			payloadType: 'LocalBaseSyncedPayload',
			payload:
				"interface LocalBaseSyncedPayload {\n\tworkstreamId: string | null;\n\tcheckout: string;\n\tbranch: string;\n\toutcome: 'advanced' | 'diverged' | 'failed';\n\tdetail?: string;\n}",
		},
		{
			channel: 'pull-requests:ship-changed',
			description:
				"Fires whenever a workstream's shipping state changes: its pull request phase, the step Malini is on, or a reason it needs you. A click on the pull request bar's Draft, Merge, Retry or Cancel fires `pull-requests:button-clicked` instead, with the new state.",
			facts: [
				'workstreamId',
				'state.phase',
				'state.step',
				'state.pullRequestNumber',
				'state.pullRequestUrl',
				'state.queuedAt',
				'state.attempts',
				'state.checks',
				'state.activeAutomationRunId',
				'state.failures',
				'state.failedSince',
				'state.nextAttemptAt',
				'state.waitsFor',
				'state.updatedAt',
				'merged.pullRequestNumber',
				'merged.pullRequestUrl',
			],
			payloadType: 'ShipChangedEvent',
			payload:
				"type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';\n\ntype ShipStep =\n\t| 'waiting-for-agent'\n\t| 'opening-draft'\n\t| 'pushing'\n\t| 'marking-ready'\n\t| 'updating-branch'\n\t| 'updating-from-main'\n\t| 'resolving-conflicts'\n\t| 'rerunning-checks'\n\t| 'fixing-checks'\n\t| 'addressing-review'\n\t| 'waiting-for-checks'\n\t| 'waiting-for-review'\n\t| 'waiting-for-github'\n\t| 'merging'\n\t| 'archiving';\n\ntype ShipNeedsYouReason =\n\t| 'reply-to-reviewer'\n\t| 'fix-gave-up'\n\t| 'merge-not-permitted'\n\t| 'pull-request-closed'\n\t| 'github-reconnect'\n\t| 'operation-in-progress';\n\ntype ShipNeedsYou = Readonly<{\n\treason: ShipNeedsYouReason;\n\tdetail: string;\n\tautomationRunId: string | null;\n}>;\n\ntype ShipWaitsFor = 'workflow-scope' | 'workflow-permission' | 'push-access';\n\ntype ShipStateRecord = Readonly<{\n\tworkstreamId: string;\n\tphase: ShipPhase;\n\tstep: ShipStep | null;\n\tkeep: boolean;\n\tpullRequestNumber: number | null;\n\tpullRequestUrl: string | null;\n\tneedsYou: ShipNeedsYou | null;\n\tqueuedAt: string | null;\n\tattempts: number;\n\tchecks: readonly string[];\n\tactiveAutomationRunId: string | null;\n\tlastError: string | null;\n\tgithubSaid: string | null;\n\tfailures: number;\n\tfailedSince: string | null;\n\tnextAttemptAt: string | null;\n\twaitsFor: ShipWaitsFor | null;\n\tupdatedAt: string;\n}>;\n\ntype ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;\n\ntype ShipChangedEvent = Readonly<{\n\tworkstreamId: string;\n\tstate: ShipStateRecord | null;\n\tmerged?: ShipMerged;\n}>;",
		},
		{
			channel: 'pull-requests:pull-request-changed',
			description:
				"Fires when Malini reads a workstream's pull request on GitHub and something the Shipping rule decides on changed since the last read it logged: its `state` (`open`, `draft`, `closed` or `merged`), its `checks`, whether any is `checksPending`, the `failingChecks` by name and the `blockingChecks` with when each finished, its `reviewDecision`, the unresolved `threads` and the `changeRequests` of each review with who left it, how many commits it is `behindBase`, its `mergeability`, whether you may merge it and how. Malini reads it every time the pull request bar does, and on its own only while shipping waits on GitHub. Every automation the Shipping rule starts for that pull request names the latest one as its cause.",
			facts: [
				'workstreamId',
				'pullRequestNumber',
				'pullRequestUrl',
				'state',
				'baseBranch',
				'headSha',
				'checks',
				'checksPending',
				'failingChecks',
				'blockingChecks',
				'reviewDecision',
				'unresolvedThreads',
				'changeRequests',
				'threads',
				'behindBase',
				'conflicts',
				'mergeability',
				'viewerCanMerge',
				'mergeMethod',
			],
			payloadType: 'PullRequestChangedEvent',
			payload:
				"type PullRequestFailedCheck = Readonly<{\n\tname: string;\n\tstate: string;\n\trequired: boolean | null;\n\tappId: number | null;\n\turl: string | null;\n\tcompletedAt: string | null;\n}>;\n\ntype PullRequestReviewItem = Readonly<{ id: string; by: string | null; bot: boolean }>;\n\ntype PullRequestMergeability = 'ready' | 'conflicts' | 'behind' | 'blocked' | 'unknown';\n\ntype PullRequestChangedEvent = Readonly<{\n\tworkstreamId: string;\n\tpullRequestNumber: number;\n\tpullRequestUrl: string | null;\n\tstate: 'open' | 'draft' | 'closed' | 'merged';\n\tbaseBranch: string;\n\theadSha: string | null;\n\tchecks: 'none' | 'success' | 'pending' | 'failed' | 'unknown';\n\tchecksPending: boolean;\n\tfailingChecks: readonly string[];\n\tblockingChecks: readonly PullRequestFailedCheck[];\n\treviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;\n\tunresolvedThreads: number | null;\n\tchangeRequests: readonly PullRequestReviewItem[] | null;\n\tthreads: readonly PullRequestReviewItem[] | null;\n\tbehindBase: number | null;\n\tconflicts: boolean;\n\tmergeability: PullRequestMergeability;\n\tviewerCanMerge: boolean | null;\n\tmergeMethod: string | null;\n}>;",
		},
		{
			channel: 'pull-requests:button-clicked',
			description:
				"Fires when you click Draft, Merge, Retry or Cancel on a workstream's pull request bar, with the `button` and the workstream's new shipping state; the reconciler's Shipping rule takes the workstream from there. Draft all and Merge all on a chat that started workstreams fire it too, with `draft-all` or `merge-all`, the `workstreamIds` to ship and the `chatSessionId` to report to, and the Shipping rule runs Open draft or Merge in each.",
			facts: ['workstreamId', 'button', 'workstreamIds', 'chatSessionId'],
			payloadType: 'ShipButtonClickedEvent',
			payload:
				"type ShipButton = 'draft' | 'merge' | 'retry' | 'cancel' | 'keep';\n\ntype ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';\n\ntype ShipStep =\n\t| 'waiting-for-agent'\n\t| 'opening-draft'\n\t| 'pushing'\n\t| 'marking-ready'\n\t| 'updating-branch'\n\t| 'updating-from-main'\n\t| 'resolving-conflicts'\n\t| 'rerunning-checks'\n\t| 'fixing-checks'\n\t| 'addressing-review'\n\t| 'waiting-for-checks'\n\t| 'waiting-for-review'\n\t| 'waiting-for-github'\n\t| 'merging'\n\t| 'archiving';\n\ntype ShipNeedsYouReason =\n\t| 'reply-to-reviewer'\n\t| 'fix-gave-up'\n\t| 'merge-not-permitted'\n\t| 'pull-request-closed'\n\t| 'github-reconnect'\n\t| 'operation-in-progress';\n\ntype ShipNeedsYou = Readonly<{\n\treason: ShipNeedsYouReason;\n\tdetail: string;\n\tautomationRunId: string | null;\n}>;\n\ntype ShipWaitsFor = 'workflow-scope' | 'workflow-permission' | 'push-access';\n\ntype ShipStateRecord = Readonly<{\n\tworkstreamId: string;\n\tphase: ShipPhase;\n\tstep: ShipStep | null;\n\tkeep: boolean;\n\tpullRequestNumber: number | null;\n\tpullRequestUrl: string | null;\n\tneedsYou: ShipNeedsYou | null;\n\tqueuedAt: string | null;\n\tattempts: number;\n\tchecks: readonly string[];\n\tactiveAutomationRunId: string | null;\n\tlastError: string | null;\n\tgithubSaid: string | null;\n\tfailures: number;\n\tfailedSince: string | null;\n\tnextAttemptAt: string | null;\n\twaitsFor: ShipWaitsFor | null;\n\tupdatedAt: string;\n}>;\n\ntype ShipAllButton = 'draft-all' | 'merge-all';\n\ntype ShipAllClicked = Readonly<{\n\tworkstreamId: string;\n\tbutton: ShipAllButton;\n\tworkstreamIds: readonly string[];\n\tchatSessionId: string | null;\n}>;\n\ntype ShipButtonClickedEvent =\n\t| Readonly<{\n\t\t\tworkstreamId: string;\n\t\t\tbutton: ShipButton;\n\t\t\tstate: ShipStateRecord | null;\n\t  }>\n\t| ShipAllClicked;",
		},
		{
			channel: 'pull-requests:workstream-opened',
			description:
				'Fires each time you open a workstream, for automations to start on. Malini does not update a workstream from main on it: only merging does.',
			facts: ['workstreamId'],
			payloadType: 'WorkstreamOpenedEvent',
			payload: 'type WorkstreamOpenedEvent = Readonly<{ workstreamId: string }>;',
		},
		{
			channel: 'automations:run-changed',
			description:
				'Fires whenever an automation run waits for you, is queued, starts, needs you, finishes as succeeded, failed or cancelled, or runs again because its agent went on after the background commands its turn ended over. Malini does not keep it in its event log: it keeps `automations:run-started` and `automations:run-finished`.',
			facts: [
				'run.id',
				'run.definitionId',
				'run.workstreamId',
				'run.repositoryId',
				'run.sessionId',
				'run.agentRunId',
				'run.origin',
				'run.status',
				'run.parentRunId',
				'run.chatSessionId',
				'run.chatAfterRunId',
				'run.chainId',
				'run.createdAt',
				'run.startedAt',
				'run.finishedAt',
			],
			payloadType: 'AutomationRunChangedEvent',
			payload:
				"const AUTOMATION_RUN_ORIGINS = [\n\t'merge-queue',\n\t'manual',\n\t'trigger',\n\t'then',\n\t'schedule',\n\t'reconciler',\n\t'compatibility',\n] as const;\n\ntype AutomationRunOrigin = (typeof AUTOMATION_RUN_ORIGINS)[number];\n\nconst AUTOMATION_RUN_STATUSES = [\n\t'waiting',\n\t'queued',\n\t'running',\n\t'needs-you',\n\t'succeeded',\n\t'failed',\n\t'cancelled',\n] as const;\n\ntype AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];\n\ntype AutomationRunRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\ttitle: string;\n\tworkstreamId: string | null;\n\trepositoryId: string | null;\n\tsessionId: string | null;\n\tagentRunId: string | null;\n\torigin: AutomationRunOrigin;\n\tstatus: AutomationRunStatus;\n\tinterrupted: boolean;\n\tdetail: string | null;\n\tparentRunId: string | null;\n\tchatSessionId: string | null;\n\tchatAfterRunId: string | null;\n\tchainId: string;\n\trequests: number;\n\tcreatedAt: string;\n\tstartedAt: string | null;\n\tfinishedAt: string | null;\n}>;\n\ntype AutomationRunChangedEvent = Readonly<{ run: AutomationRunRecord }>;",
		},
		{
			channel: 'automations:run-started',
			description:
				'Fires when an automation run starts working, with the run; a run Malini puts back in the queue fires it again when it starts again.',
			facts: [
				'run.id',
				'run.definitionId',
				'run.workstreamId',
				'run.repositoryId',
				'run.sessionId',
				'run.agentRunId',
				'run.origin',
				'run.status',
				'run.parentRunId',
				'run.chatSessionId',
				'run.chatAfterRunId',
				'run.chainId',
				'run.createdAt',
				'run.startedAt',
				'run.finishedAt',
			],
			payloadType: 'AutomationRunChangedEvent',
			payload:
				"const AUTOMATION_RUN_ORIGINS = [\n\t'merge-queue',\n\t'manual',\n\t'trigger',\n\t'then',\n\t'schedule',\n\t'reconciler',\n\t'compatibility',\n] as const;\n\ntype AutomationRunOrigin = (typeof AUTOMATION_RUN_ORIGINS)[number];\n\nconst AUTOMATION_RUN_STATUSES = [\n\t'waiting',\n\t'queued',\n\t'running',\n\t'needs-you',\n\t'succeeded',\n\t'failed',\n\t'cancelled',\n] as const;\n\ntype AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];\n\ntype AutomationRunRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\ttitle: string;\n\tworkstreamId: string | null;\n\trepositoryId: string | null;\n\tsessionId: string | null;\n\tagentRunId: string | null;\n\torigin: AutomationRunOrigin;\n\tstatus: AutomationRunStatus;\n\tinterrupted: boolean;\n\tdetail: string | null;\n\tparentRunId: string | null;\n\tchatSessionId: string | null;\n\tchatAfterRunId: string | null;\n\tchainId: string;\n\trequests: number;\n\tcreatedAt: string;\n\tstartedAt: string | null;\n\tfinishedAt: string | null;\n}>;\n\ntype AutomationRunChangedEvent = Readonly<{ run: AutomationRunRecord }>;",
		},
		{
			channel: 'automations:run-finished',
			description:
				'Fires when an automation run ends, with the run and its `status`: `succeeded`, `failed` or `cancelled`. An automation runs after another on it, such as `on automations:run-finished where run.status is failed`. A run whose turn ended while only background commands run finishes at once, and when its agent goes on once they end, it runs again and fires this again at its next end.',
			facts: [
				'run.id',
				'run.definitionId',
				'run.workstreamId',
				'run.repositoryId',
				'run.sessionId',
				'run.agentRunId',
				'run.origin',
				'run.status',
				'run.parentRunId',
				'run.chatSessionId',
				'run.chatAfterRunId',
				'run.chainId',
				'run.createdAt',
				'run.startedAt',
				'run.finishedAt',
			],
			payloadType: 'AutomationRunChangedEvent',
			payload:
				"const AUTOMATION_RUN_ORIGINS = [\n\t'merge-queue',\n\t'manual',\n\t'trigger',\n\t'then',\n\t'schedule',\n\t'reconciler',\n\t'compatibility',\n] as const;\n\ntype AutomationRunOrigin = (typeof AUTOMATION_RUN_ORIGINS)[number];\n\nconst AUTOMATION_RUN_STATUSES = [\n\t'waiting',\n\t'queued',\n\t'running',\n\t'needs-you',\n\t'succeeded',\n\t'failed',\n\t'cancelled',\n] as const;\n\ntype AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];\n\ntype AutomationRunRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\ttitle: string;\n\tworkstreamId: string | null;\n\trepositoryId: string | null;\n\tsessionId: string | null;\n\tagentRunId: string | null;\n\torigin: AutomationRunOrigin;\n\tstatus: AutomationRunStatus;\n\tinterrupted: boolean;\n\tdetail: string | null;\n\tparentRunId: string | null;\n\tchatSessionId: string | null;\n\tchatAfterRunId: string | null;\n\tchainId: string;\n\trequests: number;\n\tcreatedAt: string;\n\tstartedAt: string | null;\n\tfinishedAt: string | null;\n}>;\n\ntype AutomationRunChangedEvent = Readonly<{ run: AutomationRunRecord }>;",
		},
		{
			channel: 'automations:definition-changed',
			description:
				'Fires when an automation is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.',
			facts: [
				'definitionId',
				'definition.id',
				'definition.name',
				'definition.model',
				'definition.effort',
				'definition.runsIn',
				'definition.builtin',
				'definition.thenAutomationId',
				'definition.createdAt',
				'definition.updatedAt',
			],
			payloadType: 'AutomationDefinitionChangedEvent',
			payload:
				"type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';\n\ntype AutomationRunsIn = 'workstream' | 'new-workstream';\n\ntype AutomationBuiltin =\n\t| 'name-chats'\n\t| 'name-services'\n\t| 'fix-checks'\n\t| 'update-from-main'\n\t| 'resolve-conflicts'\n\t| 'address-review'\n\t| 'check-compatibility'\n\t| 'update-docs'\n\t| 'open-draft'\n\t| 'merge'\n\t| 'reconcile'\n\t| 'suggest-automations'\n\t| 'capture-brain'\n\t| 'write-brain-notes';\n\ntype AutomationRunMode = 'off' | 'ask' | 'auto';\n\ntype AutomationTrigger = Readonly<{ when: string; mode: AutomationRunMode }>;\n\ntype AutomationEventSight = 'facts' | 'full';\n\ntype AutomationChatSight = 'none' | 'starter' | 'all';\n\ntype AutomationBoundary = Readonly<{\n\tevent: AutomationEventSight;\n\tbefore: boolean;\n\tchats: AutomationChatSight;\n\tattachments: boolean;\n\tinternet: boolean;\n}>;\n\ntype AutomationDefinitionRecord = Readonly<{\n\tid: string;\n\tname: string;\n\tinstructions: string;\n\tprovider: string;\n\tmodel: string;\n\teffort: AgentReasoningEffort;\n\trunsIn: AutomationRunsIn;\n\tskills: readonly string[];\n\tbuiltin: AutomationBuiltin | null;\n\ttrigger: AutomationTrigger | null;\n\tthenAutomationId: string | null;\n\tboundary: AutomationBoundary;\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype AutomationDefinitionChangedEvent = Readonly<{\n\tdefinitionId: string;\n\tdefinition: AutomationDefinitionRecord | null;\n}>;",
		},
		{
			channel: 'automations:suggested',
			description:
				'Fires when you ask for the same follow-up after another pull request merges in a repository, and Malini drafts an automation that does it after each merge. Also fires when you save or dismiss that draft.',
			facts: [
				'suggestion.id',
				'suggestion.repositoryId',
				'suggestion.sessionId',
				'suggestion.name',
				'suggestion.when',
				'suggestion.status',
				'suggestion.definitionId',
				'suggestion.createdAt',
				'suggestion.updatedAt',
			],
			payloadType: 'AutomationSuggestedEvent',
			payload:
				"const AUTOMATION_SUGGESTION_STATUSES = ['open', 'dismissed', 'accepted'] as const;\n\ntype AutomationSuggestionStatus = (typeof AUTOMATION_SUGGESTION_STATUSES)[number];\n\ntype AutomationAskRecord = Readonly<{\n\ttext: string;\n\tworkstreamId: string;\n\tpullRequestNumber: number | null;\n\taskedAt: string;\n}>;\n\ntype AutomationSuggestionRecord = Readonly<{\n\tid: string;\n\trepositoryId: string;\n\tsessionId: string;\n\tafterRunId: string;\n\tname: string;\n\tinstructions: string;\n\twhen: string;\n\tstatus: AutomationSuggestionStatus;\n\tdefinitionId: string | null;\n\tasks: readonly AutomationAskRecord[];\n\tcreatedAt: string;\n\tupdatedAt: string;\n}>;\n\ntype AutomationSuggestedEvent = Readonly<{ suggestion: AutomationSuggestionRecord }>;",
		},
		{
			channel: 'automations:experiment-changed',
			description:
				"Fires when an experiment on an automation's Improve page finishes replaying the automation's recent tasks, with every result.",
			facts: [
				'experiment.id',
				'experiment.definitionId',
				'experiment.name',
				'experiment.model',
				'experiment.current',
				'experiment.running',
				'experiment.createdAt',
			],
			payloadType: 'AutomationExperimentChangedEvent',
			payload:
				'type AutomationExperimentResult = Readonly<{\n\toutputId: string;\n\toutput: string | null;\n\terror: string | null;\n}>;\n\ntype AutomationExperimentRecord = Readonly<{\n\tid: string;\n\tdefinitionId: string;\n\tname: string;\n\tprovider: string;\n\tmodel: string;\n\tinstructions: string;\n\tcurrent: boolean;\n\trunning: boolean;\n\tresults: readonly AutomationExperimentResult[];\n\tcreatedAt: string;\n}>;\n\ntype AutomationExperimentChangedEvent = Readonly<{ experiment: AutomationExperimentRecord }>;',
		},
		{
			channel: 'automations:agent-action-changed',
			description:
				"Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome. Malini does not keep it in its event log: it keeps `automations:tool-called`.",
			facts: [
				'action.id',
				'action.sessionId',
				'action.runId',
				'action.workstreamId',
				'action.tool',
				'action.status',
				'action.approval',
				'action.startedAt',
				'action.finishedAt',
			],
			payloadType: 'AgentActionChangedEvent',
			payload:
				"const AGENT_ACTION_STATUSES = ['running', 'succeeded', 'failed', 'denied'] as const;\n\ntype AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];\n\nconst AGENT_ACTION_APPROVALS = [\n\t'not-needed',\n\t'allowed',\n\t'always-allowed',\n\t'denied',\n] as const;\n\ntype AgentActionApproval = (typeof AGENT_ACTION_APPROVALS)[number];\n\ntype AgentActionRecord = Readonly<{\n\tid: string;\n\tsessionId: string;\n\trunId: string;\n\tworkstreamId: string | null;\n\ttool: string;\n\tinput: Readonly<Record<string, unknown>>;\n\tstatus: AgentActionStatus;\n\tapproval: AgentActionApproval;\n\toutput: string | null;\n\tstartedAt: string;\n\tfinishedAt: string | null;\n}>;\n\ntype AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;",
		},
		{
			channel: 'automations:tool-called',
			description:
				"Fires once when an agent calls one of Malini's tools, with the tool, its input and whether the call needed your yes.",
			facts: [
				'action.id',
				'action.sessionId',
				'action.runId',
				'action.workstreamId',
				'action.tool',
				'action.status',
				'action.approval',
				'action.startedAt',
				'action.finishedAt',
			],
			payloadType: 'AgentActionChangedEvent',
			payload:
				"const AGENT_ACTION_STATUSES = ['running', 'succeeded', 'failed', 'denied'] as const;\n\ntype AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];\n\nconst AGENT_ACTION_APPROVALS = [\n\t'not-needed',\n\t'allowed',\n\t'always-allowed',\n\t'denied',\n] as const;\n\ntype AgentActionApproval = (typeof AGENT_ACTION_APPROVALS)[number];\n\ntype AgentActionRecord = Readonly<{\n\tid: string;\n\tsessionId: string;\n\trunId: string;\n\tworkstreamId: string | null;\n\ttool: string;\n\tinput: Readonly<Record<string, unknown>>;\n\tstatus: AgentActionStatus;\n\tapproval: AgentActionApproval;\n\toutput: string | null;\n\tstartedAt: string;\n\tfinishedAt: string | null;\n}>;\n\ntype AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;",
		},
		{
			channel: 'automations:decision-changed',
			description:
				'Fires when the event reconciler decides what to do about an event no trigger handled, records that it does nothing because other work already takes it, waits to wake a busy chat, asks you, or carries out what you picked, with the facts it saw, the candidates and the pick. Malini keeps it in the decision log, not in its event log.',
			facts: [
				'decision.id',
				'decision.eventId',
				'decision.channel',
				'decision.chainId',
				'decision.workstreamId',
				'decision.pick',
				'decision.chosen',
				'decision.decidedBy',
				'decision.status',
				'decision.automationRunId',
				'decision.subjectRunId',
				'decision.createdAt',
				'decision.finishedAt',
			],
			payloadType: 'ReconcilerDecisionChangedEvent',
			payload:
				"type WakeAbout = 'workstream' | 'automation' | 'conflict';\n\ntype ReconcilerCandidate =\n\t| Readonly<{ kind: 'nothing'; label: string }>\n\t| Readonly<{\n\t\t\tkind: 'wake-chat';\n\t\t\tlabel: string;\n\t\t\tsessionId: string;\n\t\t\tworkstreamId: string;\n\t\t\tfrom: string;\n\t\t\treport: string;\n\t\t\tabout?: WakeAbout;\n\t  }>\n\t| Readonly<{\n\t\t\tkind: 'run-automation';\n\t\t\tlabel: string;\n\t\t\tdefinitionId: string;\n\t\t\tworkstreamId: string;\n\t\t\tcontext: string;\n\t  }>\n\t| Readonly<{ kind: 'ask-you'; label: string; reason: string }>;\n\nconst RECONCILER_DECIDERS = ['model', 'rules', 'you'] as const;\n\ntype ReconcilerDecider = (typeof RECONCILER_DECIDERS)[number];\n\nconst RECONCILER_DECISION_STATUSES = [\n\t'pending',\n\t'done',\n\t'asking',\n\t'dismissed',\n\t'failed',\n] as const;\n\ntype ReconcilerDecisionStatus = (typeof RECONCILER_DECISION_STATUSES)[number];\n\ntype ReconcilerDecisionRecord = Readonly<{\n\tid: string;\n\teventId: number;\n\tchannel: string;\n\tchainId: string;\n\tworkstreamId: string | null;\n\tfacts: readonly string[];\n\tcandidates: readonly ReconcilerCandidate[];\n\tpick: number | null;\n\tchosen: number;\n\tdecidedBy: ReconcilerDecider;\n\tstatus: ReconcilerDecisionStatus;\n\tdetail: string | null;\n\tautomationRunId: string | null;\n\tsubjectRunId: string | null;\n\tcreatedAt: string;\n\tfinishedAt: string | null;\n}>;\n\ntype ReconcilerDecisionChangedEvent = Readonly<{ decision: ReconcilerDecisionRecord }>;",
		},
		{
			channel: 'automations:time-reached',
			description:
				"Fires when the time an automation's schedule names comes, with the automation, its schedule and the time it was due, once per time, and once on return for the latest time Malini missed while the Mac slept or Malini was closed. The reconciler's Schedules rule starts the automation on it, unless the automation has a run that has not finished; a run its schedule started that waits for your yes gives way to the new one. It also fires with a `workstreamId` and a `wait` when a wait the Shipping rule set for that workstream ends: `retry` after a step failed or when a step Malini took brought no event back, `checks` once a fix had a minute for its failing checks to run again, `idle` once the workstream's agent has been idle long enough to act; `causeEventId` names the event whose decision set the wait. With `wait` set to `resume`, it names the `sessionId` and `runId` of a turn a usage limit or an outage paused, and the Resume rule continues that turn.",
			facts: ['definitionId', 'name', 'when', 'due'],
			payloadType: 'TimeReachedEvent',
			payload:
				"type ScheduleTimeReached = Readonly<{\n\tdefinitionId: string;\n\tname: string;\n\twhen: string;\n\tdue: string;\n}>;\n\ntype ShippingWait = 'retry' | 'checks' | 'idle';\n\ntype ShippingTimeReached = Readonly<{\n\tworkstreamId: string;\n\twait: ShippingWait;\n\tdue: string;\n\tcauseEventId?: number;\n}>;\n\ntype ResumeTimeReached = Readonly<{\n\tworkstreamId: string;\n\tsessionId: string;\n\trunId: string;\n\twait: 'resume';\n\tdue: string;\n}>;\n\ntype AlarmTimeReached = ShippingTimeReached | ResumeTimeReached;\n\ntype TimeReachedEvent = ScheduleTimeReached | AlarmTimeReached;",
		},
		{
			channel: 'app:started',
			description:
				"Fires once each time Malini starts, as soon as its event log listens, with the version that started. The reconciler's Resume rule continues the chat turns a restart cut short on it, and its Shipping rule picks up every workstream it was shipping.",
			facts: ['version'],
			payloadType: 'AppStartedPayload',
			payload: 'type AppStartedPayload = Readonly<{ version: string }>;',
		},
		{
			channel: 'app:close-requested',
			description:
				'Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.',
			facts: [],
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
		},
		{
			channel: 'app:scale-changed',
			description:
				'Fires when the interface scale or the display the window sits on changes, so layouts can measure again. Malini does not keep it in its event log.',
			facts: [],
			payloadType: 'EmptyEventPayload',
			payload: 'type EmptyEventPayload = Readonly<Record<string, never>>;',
		},
		{
			channel: 'app:full-screen-changed',
			description:
				'Fires when the Malini window enters or leaves full screen, with whether it is full screen now. Malini does not keep it in its event log.',
			facts: ['fullScreen'],
			payloadType: 'FullScreenChangedPayload',
			payload: 'type FullScreenChangedPayload = Readonly<{ fullScreen: boolean }>;',
		},
		{
			channel: 'app:notification-opened',
			description: 'Fires when you click a Malini notification, with the chat it points to.',
			facts: ['workstreamId', 'sessionId'],
			payloadType: 'NotificationTarget',
			payload: 'type NotificationTarget = Readonly<{ workstreamId: string; sessionId: string }>;',
		},
		{
			channel: 'app:menu-command-chosen',
			description:
				"Fires when you pick New Workstream, New Chat, Open Folder…, Find Repository…, Accounts… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.",
			facts: ['command'],
			payloadType: 'MenuCommandChosen',
			payload:
				"type MenuCommand =\n\t'new-workstream' | 'new-chat' | 'open-folder' | 'find-repository' | 'accounts' | 'settings';\n\ntype MenuCommandChosen = Readonly<{ command: MenuCommand }>;",
		},
		{
			channel: 'app:streaming-changed',
			description:
				'Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.',
			facts: ['streaming'],
			payloadType: 'StreamingChangedPayload',
			payload: 'type StreamingChangedPayload = Readonly<{ streaming: boolean }>;',
		},
		{
			channel: 'app:updated',
			description:
				"Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed. The reconciler's Compatibility rule runs Check compatibility on it.",
			facts: ['from', 'to', 'changes'],
			payloadType: 'AppUpdatedPayload',
			payload:
				'type ContractPayloadChange = Readonly<{ channel: string; before: string; after: string }>;\n\ntype ContractChanges = Readonly<{\n\tadded: readonly string[];\n\tremoved: readonly string[];\n\tchanged: readonly ContractPayloadChange[];\n}>;\n\ntype AppUpdatedPayload = Readonly<{ from: string; to: string; changes: ContractChanges }>;',
		},
		{
			channel: 'app:update-staged',
			description:
				'Fires when a new Malini version has downloaded and installs on the next restart, with that version.',
			facts: ['version'],
			payloadType: 'UpdateStagedPayload',
			payload: 'type UpdateStagedPayload = Readonly<{ version: string }>;',
		},
		{
			channel: 'app:update-status-changed',
			description:
				'Fires when the update status in the sidebar changes: checking or downloading after you chose Check for Updates…, up to date, failed, a version ready to install, or nothing to show. Malini does not keep it in its event log.',
			facts: ['state', 'version'],
			payloadType: 'UpdateStatus',
			payload:
				"type UpdateStatus = Readonly<\n\t| { state: 'idle' }\n\t| { state: 'checking' }\n\t| { state: 'downloading'; version: string }\n\t| { state: 'up-to-date'; version: string }\n\t| { state: 'failed'; error: string }\n\t| { state: 'ready'; version: string }\n>;",
		},
		{
			channel: 'browser:state-changed',
			description:
				"Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure. Malini does not keep it in its event log.",
			facts: ['workstreamId', 'tabId', 'loading', 'canGoBack', 'canGoForward'],
			payloadType: 'BrowserState',
			payload:
				'type BrowserState = Readonly<{\n\tworkstreamId: string;\n\ttabId: string;\n\turl: string;\n\ttitle: string;\n\tfavicon: string | null;\n\tloading: boolean;\n\tcanGoBack: boolean;\n\tcanGoForward: boolean;\n\tfailure: string | null;\n}>;',
		},
		{
			channel: 'browser:tab-opened',
			description:
				'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
			facts: ['workstreamId', 'tabId'],
			payloadType: 'BrowserTabArgs',
			payload: 'type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;',
		},
		{
			channel: 'browser:resize-requested',
			description:
				"Fires when an agent asks to make the browser tab you see wider or narrower, with the width it asked for in Malini's pixels; Malini moves the divider between the chat and the inspector to match.",
			facts: ['workstreamId', 'tabId', 'requestId', 'width'],
			payloadType: 'BrowserResizeRequest',
			payload:
				'type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;\n\ntype BrowserResizeRequest = BrowserTabArgs & Readonly<{ requestId: string; width: number }>;',
		},
		{
			channel: 'browser:thread-opened',
			description:
				'Fires when you open the thread behind a pin on a page in the browser, with its workstream and chat; Malini shows that chat in a tab of its own. Malini does not keep it in its event log.',
			facts: ['workstreamId', 'sessionId'],
			payloadType: 'BrowserThreadOpened',
			payload: 'type BrowserThreadOpened = Readonly<{ workstreamId: string; sessionId: string }>;',
		},
		{
			channel: 'extensions:file-open-requested',
			description:
				"Fires when an agent opens a file for the user to edit, with the workstream, the file's path (relative to the worktree, or absolute outside it) and the line to show; Malini opens it in a File tab beside the workstream's chats.",
			facts: ['workstreamId', 'path', 'line'],
			payloadType: 'FileOpenRequestedPayload',
			payload:
				'type FileOpenRequestedPayload = Readonly<{\n\tworkstreamId: string;\n\tpath: string;\n\tline: number | null;\n}>;',
		},
		{
			channel: 'stats:resources-sampled',
			description:
				'Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use. Malini does not keep it in its event log.',
			facts: ['sampledAt', 'memoryBytes', 'cpuPercent', 'processes'],
			payloadType: 'ResourceSample',
			payload:
				"type ResourceKind = 'malini' | 'browser' | 'agents' | 'tools' | 'docker';\n\ntype ResourceUsage = Readonly<{\n\tkind: ResourceKind;\n\tmemoryBytes: number;\n\tcpuPercent: number;\n\tprocesses: number;\n}>;\n\ntype ResourceSample = Readonly<{\n\tsampledAt: number;\n\tmemoryBytes: number;\n\tcpuPercent: number;\n\tprocesses: number;\n\tusage: readonly ResourceUsage[];\n}>;",
		},
		{
			channel: 'stats:workstream-running-changed',
			description:
				'Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers. Malini does not keep it in its event log.',
			facts: [],
			payloadType: 'readonly WorkstreamRunning[]',
			payload:
				"type RunningItemOrigin = 'agent' | 'docker';\n\ntype RunningItemKind = 'service' | 'task';\n\ntype RunningItem = Readonly<{\n\tid: string;\n\torigin: RunningItemOrigin;\n\tname: string;\n\tkind: RunningItemKind;\n\tdetail: string;\n\tgroup: string | null;\n\tstartedAt: number;\n\tports: readonly number[];\n}>;\n\ntype WorkstreamTurn = Readonly<{\n\tendedAt: number;\n\toutcome: string | null;\n\tneed: string | null;\n}>;\n\ntype WorkstreamRunning = Readonly<{\n\tworkstreamId: string;\n\titems: readonly RunningItem[];\n\tbehind: readonly string[];\n\tturn: WorkstreamTurn | null;\n}>;",
		},
		{
			channel: 'stats:profile-changed',
			description:
				'Fires when your Bestboy profile changes in Malini: you sign in or out, **Publish my stats** turns on or off, you pick other public repositories, or an upload or a removal of your stats finishes or fails. Malini does not keep it in its event log.',
			facts: [
				'profile.handle',
				'profile.public',
				'profile.url',
				'signingIn',
				'signInNeeded',
				'publishing',
			],
			payloadType: 'ProfileState',
			payload:
				"type BestboyAccount = Readonly<{ name: string; email: string }>;\n\ntype BestboyProfile = Readonly<{\n\thandle: string | null;\n\tpublic: boolean;\n\turl: string | null;\n}>;\n\ntype BestboyTerms = Readonly<{ date: string; termsUrl: string; privacyUrl: string }>;\n\ntype StatsPublishing = 'off' | 'on' | 'removing';\n\ntype StatsUpload =\n\t| Readonly<{ state: 'idle' }>\n\t| Readonly<{ state: 'sending' }>\n\t| Readonly<{ state: 'published'; through: string }>\n\t| Readonly<{ state: 'no-full-day' }>\n\t| Readonly<{ state: 'failed'; reason: string; retrying: boolean }>;\n\ntype ProfileState = Readonly<{\n\taccount: BestboyAccount | null;\n\tprofile: BestboyProfile | null;\n\tunacceptedTerms: BestboyTerms | null;\n\tsigningIn: boolean;\n\tsignInNeeded: boolean;\n\tsignInProblem: string | null;\n\tpublishing: StatsPublishing;\n\tupload: StatsUpload;\n\tpickedRepositories: readonly string[];\n\tsuggestedHandle: string | null;\n}>;",
		},
		{
			channel: 'stats:profile-published',
			description:
				'Fires when you claim your `@handle` and **Publish my stats** turns on, with your Bestboy profile: its handle, whether it is public, and its address.',
			facts: ['handle', 'public', 'url'],
			payloadType: 'BestboyProfile',
			payload:
				'type BestboyProfile = Readonly<{\n\thandle: string | null;\n\tpublic: boolean;\n\turl: string | null;\n}>;',
		},
		{
			channel: 'secrets:requested',
			description:
				'Fires when an agent asks you for secrets by name with `secrets_request`, with the chat that asked, the names, why it needs them and which of them you already saved; the chat shows a card where you paste them. It carries no value.',
			facts: [
				'request.id',
				'request.sessionId',
				'request.names',
				'request.repository',
				'request.saved',
				'request.askedAt',
			],
			payloadType: 'SecretsRequestedEvent',
			payload:
				'type SecretRequest = Readonly<{\n\tid: string;\n\tsessionId: string;\n\tnames: readonly string[];\n\twhy: string;\n\trepository: string | null;\n\tsaved: readonly string[];\n\taskedAt: string;\n}>;\n\ntype SecretsRequestedEvent = Readonly<{ request: SecretRequest }>;',
		},
		{
			channel: 'brain:changed',
			description:
				'Fires when your second brain changes: it is set up, a capture or new notes land in it, a push to GitHub goes through or stops on a problem, or you turn its sync on or off, with its `status`. It never carries what the brain says.',
			facts: [
				'status.set',
				'status.repository',
				'status.sync',
				'status.syncedAt',
				'status.unpushed',
				'status.problem',
			],
			payloadType: 'BrainChangedEvent',
			payload:
				'type BrainStatus = Readonly<{\n\tset: boolean;\n\trepository: string | null;\n\tsync: boolean;\n\tworkstreamId: string | null;\n\tlocation: string | null;\n\tsyncedAt: string | null;\n\tunpushed: number;\n\tproblem: string | null;\n}>;\n\ntype BrainChangedEvent = Readonly<{ status: BrainStatus }>;',
		},
		{
			channel: 'secrets:saved',
			description:
				'Fires when you save secrets, on the card a chat showed or under Settings, Secrets, with their names, the repository they are for (`null` for everywhere), and the request and chat they answer, or `null` from Settings. It never carries a value.',
			facts: ['names', 'unsaved', 'repository', 'requestId', 'sessionId'],
			payloadType: 'SecretsSavedEvent',
			payload:
				'type SecretsSavedEvent = Readonly<{\n\tnames: readonly string[];\n\tunsaved: readonly string[];\n\trepository: string | null;\n\trequestId: string | null;\n\tsessionId: string | null;\n}>;',
		},
		{
			channel: 'secrets:request-dismissed',
			description:
				'Fires when you dismiss the card where an agent asked you for secrets, with the request and its chat.',
			facts: ['requestId', 'sessionId'],
			payloadType: 'SecretRequestDismissedEvent',
			payload:
				'type SecretRequestDismissedEvent = Readonly<{ requestId: string; sessionId: string }>;',
		},
		{
			channel: 'secrets:deleted',
			description:
				'Fires when you delete a secret under Settings, Secrets, with its name and the repository it was for (`null` for everywhere).',
			facts: ['name', 'repository'],
			payloadType: 'SecretDeletedEvent',
			payload: 'type SecretDeletedEvent = Readonly<{ name: string; repository: string | null }>;',
		},
		{
			channel: 'extensions:changed',
			description:
				'Fires when an extension from the marketplace is installed, updated, uninstalled, turned on or off, or withdrawn because its publisher pulled the version you have, with its publisher, name, version and that `change`. Every chat picks the change up at its next prompt.',
			facts: ['publisher', 'name', 'version', 'change'],
			payloadType: 'ExtensionChangedEvent',
			payload:
				"type ExtensionChange =\n\t'installed' | 'updated' | 'uninstalled' | 'turned-on' | 'turned-off' | 'withdrawn';\n\ntype ExtensionChangedEvent = Readonly<{\n\tpublisher: string;\n\tname: string;\n\tversion: string;\n\tchange: ExtensionChange;\n}>;",
		},
		{
			channel: 'extensions:published',
			description:
				'Fires when you publish an extension from one of your repositories to the marketplace on bestboy.dev, with its publisher, name, the version that went live and the repository it came from.',
			facts: ['publisher', 'name', 'version', 'repository'],
			payloadType: 'ExtensionPublishedEvent',
			payload:
				'type ExtensionPublishedEvent = Readonly<{\n\tpublisher: string;\n\tname: string;\n\tversion: string;\n\trepository: string;\n}>;',
		},
	],
};
