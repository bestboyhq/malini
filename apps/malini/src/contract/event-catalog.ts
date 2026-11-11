import {
	AGENT_ACTION_APPROVALS,
	AGENT_ACTION_STATUSES,
	AUTOMATION_RUN_ORIGINS,
	AUTOMATION_RUN_STATUSES,
	AUTOMATION_SUGGESTION_STATUSES,
	RECONCILER_DECIDERS,
	RECONCILER_DECISION_STATUSES,
	UNFINISHED_AUTOMATION_RUN_STATUSES,
} from './automations';
import type { ContractEvents, EventChannel } from './events';

type Keys<T> = T extends unknown ? keyof T & string : never;

type Field<T, K extends string> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;

type Nested<T, K extends string> =
	NonNullable<Field<T, K>> extends readonly unknown[]
		? never
		: NonNullable<Field<T, K>> extends object
			? `${K}.${Keys<NonNullable<Field<T, K>>>}`
			: never;

export type EventFact<T> = T extends readonly unknown[]
	? never
	: { [K in Keys<T>]: K | Nested<T, K> }[Keys<T>];

type FactValue<T, F extends string> = F extends `${infer K}.${infer R}`
	? Field<NonNullable<Field<T, K>>, R>
	: Field<T, F>;

export type EventCatalogEntry<C extends EventChannel = EventChannel> = Readonly<{
	description: string;
	logged?: false;
	facts: readonly EventFact<ContractEvents[C]>[];
	values?: {
		readonly [F in EventFact<ContractEvents[C]>]?: readonly Extract<
			FactValue<ContractEvents[C], F>,
			string
		>[];
	};
}>;

const RUN_ORIGINS = { 'run.origin': AUTOMATION_RUN_ORIGINS } as const;

const ACTION_VALUES = {
	'action.status': AGENT_ACTION_STATUSES,
	'action.approval': AGENT_ACTION_APPROVALS,
} as const;

export const EVENT_CATALOG: { readonly [C in EventChannel]: EventCatalogEntry<C> } = {
	'chat:agent-event': {
		description:
			'Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order. Malini does not keep it in its event log.',
		logged: false,
		facts: ['sessionId', 'runId', 'seq', 'emittedAt', 'event.type'],
	},
	'chat:run-changes-captured': {
		description:
			'Fires after an agent run that changed files finishes and Malini has recorded the diff of that run.',
		facts: ['sessionId', 'runId'],
	},
	'chat:checkpoint-restored': {
		description:
			"Fires after a workstream's files are restored to a chat checkpoint, rewinding the changes made after it.",
		facts: ['workstreamId', 'checkpointId', 'sessionId'],
	},
	'chat:session-renamed': {
		description:
			'Fires when a chat gets a new name, from the user or from the Name chats automation.',
		facts: ['workstreamId', 'sessionId'],
	},
	'chat:turn-finished': {
		description:
			"Fires when a turn of one of your chats ends, not an automation's or a thread's you started from a page, with how it ended and the `Outcome:` and `Needs:` lines of its report; `needs` is `null` when the turn needs nothing from you. A turn that ends while only background commands run fires it at once, naming them in `backgroundCommands`, and fires it again when the agent goes on after them and ends; `backgroundCommands` is `null` once the run itself ended. A turn that Malini quitting, an agent restart or a reset cut short ends `interrupted`, not `failed`, so `where status is failed` skips it.",
		facts: ['workstreamId', 'sessionId', 'runId', 'status'],
	},
	'chat:delivery-changed': {
		description:
			'Fires when Malini holds a prompt for a chat that is on a turn, delivers it once that turn ends, or cannot deliver it, such as a prompt one chat sends the chat of a workstream it started. Malini does not keep it in its event log.',
		logged: false,
		facts: [
			'delivery.id',
			'delivery.sessionId',
			'delivery.fromSessionId',
			'delivery.status',
			'delivery.runId',
			'delivery.createdAt',
			'delivery.deliveredAt',
		],
	},
	'chat:mcp-server-changed': {
		description:
			'Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.',
		facts: ['name', 'status', 'source', 'toolCount'],
	},
	'chat:mcp-servers-listed': {
		description:
			'Fires while the MCP servers page is open, each time the Claude Code that watches a folder sees a server connect, fail, or change, with every server of that folder and whether any is still connecting. Malini does not keep it in its event log.',
		logged: false,
		facts: ['workstreamId', 'settled'],
	},
	'chat:shell-run-changed': {
		description:
			"Fires when you run a command from a code block's Run button, while it prints, and when it ends, with the command, `anchor`: the message and the code block in it it ran from, its output so far, and `state`: `running`, `exited` with its `exitCode`, `stopped`, or `failed` when it could not start. Malini does not keep it in its event log.",
		logged: false,
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
	},
	'repositories:workstream-created': {
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
	},
	'repositories:workstream-removed': {
		description:
			'Fires when a workstream leaves the sidebar, with `archived` set when it was archived and `deleted` set when it was deleted.',
		facts: ['workstreamId', 'worktreePath', 'archived', 'deleted'],
	},
	'repositories:workstream-files-changed': {
		description:
			"Fires when files change in a workstream's checkout, with the changed paths, or `null` paths when Malini could not tell which files changed.",
		facts: ['workstreamId', 'changedAt', 'paths'],
	},
	'repositories:workstream-renamed': {
		description: 'Fires when a workstream gets a new name.',
		facts: ['workstreamId'],
	},
	'repositories:workstream-install-status': {
		description:
			"Fires as a new workstream's dependency install moves through its states: running, succeeded, failed, skipped or aborted.",
		facts: ['type', 'workstreamId', 'status', 'command', 'reason', 'durationMs', 'exitCode'],
	},
	'repositories:workstream-setup-status': {
		description:
			'Fires when Malini starts setting up a workstream an agent or an automation started, updating its base branch and installing its dependencies, and again with `done` once it finishes.',
		facts: ['workstreamId', 'status'],
	},
	'repositories:workstream-merge-conflicted': {
		description:
			"Fires when a merge in a workstream stops on conflicts, whoever started it, with the workstream's base branch and the conflicted files.",
		facts: ['workstreamId', 'baseBranch', 'conflictedPaths'],
	},
	'repositories:workstream-base-overlapped': {
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
	},
	'repositories:workstream-head-moved': {
		description:
			"Fires when the commit a workstream's checkout points to changes, whoever moved it: a commit, a merge, a pull or a reset, with the branch, or `null` when the checkout is detached, and the commits before and after; `previousHead` is `null` for the first commit of a new branch.",
		facts: ['workstreamId', 'branch', 'head', 'previousHead'],
	},
	'repositories:workstream-pushed': {
		description:
			"Fires when a workstream's branch on `origin` moves, after a push or a fetch that brings in someone else's push, with the commit it points to now.",
		facts: ['workstreamId', 'branch', 'head'],
	},
	'repositories:clone-progress': {
		description:
			'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done. Malini does not keep it in its event log.',
		logged: false,
		facts: ['repo_id', 'stage', 'fraction'],
	},
	'repositories:github-cli-install-progress': {
		description:
			'Fires repeatedly while Malini downloads the GitHub CLI after you press Install, with the bytes received and the size when known, and once more when the download ends. Malini does not keep it in its event log.',
		logged: false,
		facts: ['received', 'total'],
	},
	'repositories:changed': {
		description:
			'Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.',
		facts: [],
	},
	'repositories:github-reach-changed': {
		description:
			"Fires when GitHub stops or starts answering Malini's `gh` calls, with `reach`: `ok`, `unreachable` when GitHub does not respond, `down` when GitHub answers with a server error, or `rate-limited` when GitHub limits your account.",
		facts: ['reach'],
	},
	'providers:claude-code-install-progress': {
		description:
			'Fires repeatedly while Malini downloads Claude Code after you press Install, with the bytes received and the size, and once more when the download ends. Malini does not keep it in its event log.',
		logged: false,
		facts: ['received', 'total'],
	},
	'pull-requests:local-base-synced': {
		description:
			"Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.",
		facts: ['workstreamId', 'checkout', 'branch', 'outcome'],
	},
	'pull-requests:ship-changed': {
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
	},
	'pull-requests:pull-request-changed': {
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
	},
	'pull-requests:button-clicked': {
		description:
			"Fires when you click Draft, Merge, Retry or Cancel on a workstream's pull request bar, with the `button` and the workstream's new shipping state; the reconciler's Shipping rule takes the workstream from there. Draft all and Merge all on a chat that started workstreams fire it too, with `draft-all` or `merge-all`, the `workstreamIds` to ship and the `chatSessionId` to report to, and the Shipping rule runs Open draft or Merge in each.",
		facts: ['workstreamId', 'button', 'workstreamIds', 'chatSessionId'],
	},
	'pull-requests:workstream-opened': {
		description:
			'Fires each time you open a workstream, for automations to start on. Malini does not update a workstream from main on it: only merging does.',
		facts: ['workstreamId'],
	},
	'automations:run-changed': {
		description:
			'Fires whenever an automation run waits for you, is queued, starts, needs you, finishes as succeeded, failed or cancelled, or runs again because its agent went on after the background commands its turn ended over. Malini does not keep it in its event log: it keeps `automations:run-started` and `automations:run-finished`.',
		logged: false,
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
		values: { ...RUN_ORIGINS, 'run.status': AUTOMATION_RUN_STATUSES },
	},
	'automations:run-started': {
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
		values: { ...RUN_ORIGINS, 'run.status': ['running'] },
	},
	'automations:run-finished': {
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
		values: {
			...RUN_ORIGINS,
			'run.status': AUTOMATION_RUN_STATUSES.filter(
				(status) => !UNFINISHED_AUTOMATION_RUN_STATUSES.includes(status),
			),
		},
	},
	'automations:agent-action-changed': {
		description:
			"Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome. Malini does not keep it in its event log: it keeps `automations:tool-called`.",
		logged: false,
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
		values: ACTION_VALUES,
	},
	'automations:tool-called': {
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
		values: ACTION_VALUES,
	},
	'automations:time-reached': {
		description:
			"Fires when the time an automation's schedule names comes, with the automation, its schedule and the time it was due, once per time, and once on return for the latest time Malini missed while the Mac slept or Malini was closed. The reconciler's Schedules rule starts the automation on it, unless the automation has a run that has not finished; a run its schedule started that waits for your yes gives way to the new one. It also fires with a `workstreamId` and a `wait` when a wait the Shipping rule set for that workstream ends: `retry` after a step failed or when a step Malini took brought no event back, `checks` once a fix had a minute for its failing checks to run again, `idle` once the workstream's agent has been idle long enough to act; `causeEventId` names the event whose decision set the wait. With `wait` set to `resume`, it names the `sessionId` and `runId` of a turn a usage limit or an outage paused, and the Resume rule continues that turn.",
		facts: ['definitionId', 'name', 'when', 'due'],
	},
	'automations:decision-changed': {
		description:
			'Fires when the event reconciler decides what to do about an event no trigger handled, records that it does nothing because other work already takes it, waits to wake a busy chat, asks you, or carries out what you picked, with the facts it saw, the candidates and the pick. Malini keeps it in the decision log, not in its event log.',
		logged: false,
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
		values: {
			'decision.status': RECONCILER_DECISION_STATUSES,
			'decision.decidedBy': RECONCILER_DECIDERS,
		},
	},
	'automations:definition-changed': {
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
	},
	'automations:suggested': {
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
		values: { 'suggestion.status': AUTOMATION_SUGGESTION_STATUSES },
	},
	'automations:experiment-changed': {
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
	},
	'app:started': {
		description:
			"Fires once each time Malini starts, as soon as its event log listens, with the version that started. The reconciler's Resume rule continues the chat turns a restart cut short on it, and its Shipping rule picks up every workstream it was shipping.",
		facts: ['version'],
	},
	'app:close-requested': {
		description:
			'Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.',
		facts: [],
	},
	'app:scale-changed': {
		description:
			'Fires when the interface scale or the display the window sits on changes, so layouts can measure again. Malini does not keep it in its event log.',
		logged: false,
		facts: [],
	},
	'app:full-screen-changed': {
		description:
			'Fires when the Malini window enters or leaves full screen, with whether it is full screen now. Malini does not keep it in its event log.',
		logged: false,
		facts: ['fullScreen'],
	},
	'app:notification-opened': {
		description: 'Fires when you click a Malini notification, with the chat it points to.',
		facts: ['workstreamId', 'sessionId'],
	},
	'app:menu-command-chosen': {
		description:
			"Fires when you pick New Workstream, New Chat, Open Folder…, Find Repository…, Accounts… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.",
		facts: ['command'],
	},
	'app:streaming-changed': {
		description:
			'Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.',
		facts: ['streaming'],
	},
	'app:updated': {
		description:
			"Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed. The reconciler's Compatibility rule runs Check compatibility on it.",
		facts: ['from', 'to', 'changes'],
	},
	'app:update-staged': {
		description:
			'Fires when a new Malini version has downloaded and installs on the next restart, with that version.',
		facts: ['version'],
	},
	'app:update-status-changed': {
		description:
			'Fires when the update status in the sidebar changes: checking or downloading after you chose Check for Updates…, up to date, failed, a version ready to install, or nothing to show. Malini does not keep it in its event log.',
		logged: false,
		facts: ['state', 'version'],
	},
	'browser:state-changed': {
		description:
			"Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure. Malini does not keep it in its event log.",
		logged: false,
		facts: ['workstreamId', 'tabId', 'loading', 'canGoBack', 'canGoForward'],
	},
	'browser:tab-opened': {
		description:
			'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
		facts: ['workstreamId', 'tabId'],
	},
	'browser:tab-closed': {
		description:
			'Fires when an agent closes the browser tab it opened in a workstream; Malini takes the tab out of the inspector and closes its page. Tabs you opened stay.',
		facts: ['workstreamId', 'tabId'],
	},
	'browser:resize-requested': {
		description:
			"Fires when an agent asks to make the browser tab you see wider or narrower, with the width it asked for in Malini's pixels; Malini moves the divider between the chat and the inspector to match.",
		facts: ['workstreamId', 'tabId', 'requestId', 'width'],
	},
	'browser:thread-opened': {
		description:
			'Fires when you open the thread behind a pin on a page in the browser, with its workstream and chat; Malini shows that chat in a tab of its own. Malini does not keep it in its event log.',
		logged: false,
		facts: ['workstreamId', 'sessionId'],
	},
	'extensions:file-open-requested': {
		description:
			"Fires when an agent opens a file for the user to edit, with the workstream, the file's path (relative to the worktree, or absolute outside it) and the line to show; Malini opens it in a File tab beside the workstream's chats.",
		facts: ['workstreamId', 'path', 'line'],
	},
	'stats:resources-sampled': {
		description:
			'Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use. Malini does not keep it in its event log.',
		logged: false,
		facts: ['sampledAt', 'memoryBytes', 'cpuPercent', 'processes'],
	},
	'stats:workstream-running-changed': {
		description:
			'Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers. Malini does not keep it in its event log.',
		logged: false,
		facts: [],
	},
	'stats:profile-changed': {
		description:
			'Fires when your Bestboy profile changes in Malini: you sign in or out, **Publish my stats** turns on or off, you pick other public repositories, or an upload or a removal of your stats finishes or fails. Malini does not keep it in its event log.',
		logged: false,
		facts: [
			'profile.handle',
			'profile.public',
			'profile.url',
			'signingIn',
			'signInNeeded',
			'publishing',
		],
	},
	'stats:profile-published': {
		description:
			'Fires when you claim your `@handle` and **Publish my stats** turns on, with your Bestboy profile: its handle, whether it is public, and its address.',
		facts: ['handle', 'public', 'url'],
	},
	'secrets:requested': {
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
	},
	'brain:changed': {
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
	},
	'secrets:saved': {
		description:
			'Fires when you save secrets, on the card a chat showed or under Settings, Secrets, with their names, the repository they are for (`null` for everywhere), and the request and chat they answer, or `null` from Settings. It never carries a value.',
		facts: ['names', 'unsaved', 'repository', 'requestId', 'sessionId'],
	},
	'secrets:request-dismissed': {
		description:
			'Fires when you dismiss the card where an agent asked you for secrets, with the request and its chat.',
		facts: ['requestId', 'sessionId'],
	},
	'secrets:deleted': {
		description:
			'Fires when you delete a secret under Settings, Secrets, with its name and the repository it was for (`null` for everywhere).',
		facts: ['name', 'repository'],
	},
	'extensions:changed': {
		description:
			'Fires when an extension from the marketplace is installed, updated, uninstalled, turned on or off, or withdrawn because its publisher pulled the version you have, with its publisher, name, version and that `change`. Every chat picks the change up at its next prompt.',
		facts: ['publisher', 'name', 'version', 'change'],
	},
	'extensions:published': {
		description:
			'Fires when you publish an extension from one of your repositories to the marketplace on bestboy.dev, with its publisher, name, the version that went live and the repository it came from.',
		facts: ['publisher', 'name', 'version', 'repository'],
	},
};

export function eventFacts(channel: EventChannel, payload: unknown): Record<string, unknown> {
	const facts: Record<string, unknown> = {};
	for (const path of EVENT_CATALOG[channel].facts) {
		const [head = '', tail] = path.split('.');
		const value = fieldOf(payload, head);
		if (tail === undefined) {
			if (value !== undefined) facts[head] = value;
			continue;
		}
		const leaf = fieldOf(value, tail);
		if (leaf !== undefined) facts[head] = { ...Object(facts[head]), [tail]: leaf };
	}
	return facts;
}

export function eventFactValues(channel: EventChannel, path: string): readonly string[] | null {
	return (
		new Map<string, readonly string[] | undefined>(
			Object.entries(EVENT_CATALOG[channel].values ?? {}),
		).get(path) ?? null
	);
}

function fieldOf(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null && Object.hasOwn(value, key)
		? new Map(Object.entries(value)).get(key)
		: undefined;
}
