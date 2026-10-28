import type { EventChannel } from './events';

export type EventCatalogEntry = Readonly<{ description: string; logged?: false }>;

export const EVENT_CATALOG: Readonly<Record<EventChannel, EventCatalogEntry>> = {
	'chat:agent-event': {
		description:
			'Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order. Malini does not keep it in its event log.',
		logged: false,
	},
	'chat:run-changes-captured': {
		description:
			'Fires after an agent run that changed files finishes and Malini has recorded the diff of that run.',
	},
	'chat:checkpoint-restored': {
		description:
			"Fires after a workstream's files are restored to a chat checkpoint, rewinding the changes made after it.",
	},
	'chat:session-renamed': {
		description: 'Fires when a chat gets a new name, from the user or from the Name chats job.',
	},
	'chat:turn-finished': {
		description:
			"Fires when a turn of one of your chats ends, not a job's or a thread's you started from a page, with how it ended and the `Outcome:` and `Needs:` lines of its report; `needs` is `null` when the turn needs nothing from you.",
	},
	'chat:mcp-server-changed': {
		description:
			'Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.',
	},
	'chat:mcp-servers-listed': {
		description:
			'Fires while the MCP servers page is open, each time the Claude Code that watches a folder sees a server connect, fail, or change, with every server of that folder and whether any is still connecting. Malini does not keep it in its event log.',
		logged: false,
	},
	'repositories:workstream-created': {
		description:
			'Fires when a new workstream exists: its git worktree is checked out and it is ready for chats. `workstream.scope` is `home` or `owner:<owner>` for a chat that leads work above repositories, and `workstream.startedBy` is the id of the workstream whose chat started it.',
	},
	'repositories:workstream-removed': {
		description:
			'Fires when a workstream leaves the sidebar, with `archived` set when it was archived and `deleted` set when it was deleted.',
	},
	'repositories:workstream-files-changed': {
		description:
			"Fires when files change in a workstream's checkout, with the changed paths, or `null` paths when Malini could not tell which files changed.",
	},
	'repositories:workstream-renamed': {
		description: 'Fires when a workstream gets a new name.',
	},
	'repositories:workstream-install-status': {
		description:
			"Fires as a new workstream's dependency install moves through its states: running, succeeded, failed, skipped or aborted.",
	},
	'repositories:workstream-setup-status': {
		description:
			'Fires when Malini starts setting up a workstream an agent or a job started, updating its base branch and installing its dependencies, and again with `done` once it finishes.',
	},
	'repositories:workstream-merge-conflicted': {
		description:
			"Fires when a merge in a workstream stops on conflicts, whoever started it, with the workstream's base branch and the conflicted files.",
	},
	'repositories:workstream-head-moved': {
		description:
			"Fires when the commit a workstream's checkout points to changes, whoever moved it: a commit, a merge, a pull or a reset, with the branch, or `null` when the checkout is detached, and the commits before and after; `previousHead` is `null` for the first commit of a new branch.",
	},
	'repositories:workstream-pushed': {
		description:
			"Fires when a workstream's branch on `origin` moves, after a push or a fetch that brings in someone else's push, with the commit it points to now.",
	},
	'repositories:clone-progress': {
		description:
			'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done. Malini does not keep it in its event log.',
		logged: false,
	},
	'repositories:changed': {
		description:
			'Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.',
	},
	'repositories:github-reach-changed': {
		description:
			"Fires when GitHub stops or starts answering Malini's `gh` calls, with `reach`: `ok`, `unreachable` when GitHub does not respond, `down` when GitHub answers with a server error, or `rate-limited` when GitHub limits your account.",
	},
	'pull-requests:local-base-synced': {
		description:
			"Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.",
	},
	'pull-requests:ship-changed': {
		description:
			"Fires whenever a workstream's shipping state changes: its pull request phase, the step Malini is on, or a reason it needs you. A click on the pull request bar's Draft, Merge, Retry or Cancel fires `pull-requests:button-clicked` instead, with the new state.",
	},
	'pull-requests:pull-request-changed': {
		description:
			"Fires when Malini reads a workstream's pull request on GitHub and something the Shipping rule decides on changed since the last read it logged: its `state` (`open`, `draft`, `closed` or `merged`), its `checks`, whether any is `checksPending`, the `failingChecks` by name and the `blockingChecks` with when each finished, its `reviewDecision`, the unresolved `threads` and the `changeRequests` of each review with who left it, how many commits it is `behindBase`, its `mergeability`, whether you may merge it and how. Malini reads it every time the pull request bar does, and on its own only while shipping waits on GitHub. Every job the Shipping rule starts for that pull request names the latest one as its cause.",
	},
	'pull-requests:button-clicked': {
		description:
			"Fires when you click Draft, Merge, Retry or Cancel on a workstream's pull request bar, with the `button` and the workstream's new shipping state; the reconciler's Shipping rule takes the workstream from there. Draft all and Merge all on a chat that started workstreams fire it too, with `draft-all` or `merge-all`, the `workstreamIds` to ship and the `chatSessionId` to report to, and the Shipping rule runs Open draft or Merge in each.",
	},
	'pull-requests:workstream-opened': {
		description:
			'Fires each time you open a workstream, for jobs to start on. Malini does not update a workstream from main on it: only merging does.',
	},
	'jobs:run-changed': {
		description:
			'Fires whenever a job run waits for you, is queued, starts, needs you, or finishes as succeeded, failed or cancelled. Malini does not keep it in its event log: it keeps `jobs:run-started` and `jobs:run-finished`.',
		logged: false,
	},
	'jobs:run-started': {
		description:
			'Fires when a job run starts working, with the run; a run Malini puts back in the queue fires it again when it starts again.',
	},
	'jobs:run-finished': {
		description:
			'Fires once when a job run ends, with the run and its `status`: `succeeded`, `failed` or `cancelled`. A job runs after another on it, such as `on jobs:run-finished where run.status is failed`.',
	},
	'jobs:agent-action-changed': {
		description:
			"Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome. Malini does not keep it in its event log: it keeps `jobs:tool-called`.",
		logged: false,
	},
	'jobs:tool-called': {
		description:
			"Fires once when an agent calls one of Malini's tools, with the tool, its input and whether the call needed your yes.",
	},
	'jobs:time-reached': {
		description:
			"Fires when the time a job's schedule names comes, with the job, its schedule and the time it was due, once per time, and once on return for the latest time Malini missed while the Mac slept or Malini was closed. The reconciler's Schedules rule starts the job on it, unless the job's last run has not finished. It also fires with a `workstreamId` and a `wait` when a wait the Shipping rule set for that workstream ends: `retry` after a step failed, `checks` once a fix had a minute for its failing checks to run again. With `wait` set to `resume`, it names the `sessionId` and `runId` of a turn a usage limit or an outage paused, and the Resume rule continues that turn.",
	},
	'jobs:decision-changed': {
		description:
			'Fires when the event reconciler decides what to do about an event no trigger handled, waits to wake a busy chat, asks you, or carries out what you picked, with the facts it saw, the candidates and the pick. Malini keeps it in the decision log, not in its event log.',
		logged: false,
	},
	'jobs:definition-changed': {
		description:
			'Fires when a job is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.',
	},
	'jobs:suggested': {
		description:
			'Fires when Malini notices a prompt you keep repeating and suggests turning it into a job.',
	},
	'jobs:experiment-changed': {
		description:
			"Fires when an experiment on a job's Improve page finishes replaying the job's recent tasks, with every result.",
	},
	'app:started': {
		description:
			"Fires once each time Malini starts, as soon as its event log listens, with the version that started. The reconciler's Resume rule continues the chat turns a restart cut short on it, and its Shipping rule picks up every workstream it was shipping.",
	},
	'app:close-requested': {
		description:
			'Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.',
	},
	'app:scale-changed': {
		description:
			'Fires when the interface scale or the display the window sits on changes, so layouts can measure again. Malini does not keep it in its event log.',
		logged: false,
	},
	'app:notification-opened': {
		description: 'Fires when you click a Malini notification, with the chat it points to.',
	},
	'app:menu-command-chosen': {
		description:
			"Fires when you pick New Workstream, New Chat, Open Folder…, Clone Repository…, Accounts… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.",
	},
	'app:streaming-changed': {
		description:
			'Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.',
	},
	'app:updated': {
		description:
			"Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed. The reconciler's Compatibility rule runs Check compatibility on it.",
	},
	'app:update-staged': {
		description:
			'Fires when a new Malini version has downloaded and installs on the next restart, with that version.',
	},
	'app:update-status-changed': {
		description:
			'Fires when the update status in the sidebar changes: checking or downloading after you chose Check for Updates…, up to date, failed, a version ready to install, or nothing to show. Malini does not keep it in its event log.',
		logged: false,
	},
	'browser:state-changed': {
		description:
			"Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure. Malini does not keep it in its event log.",
		logged: false,
	},
	'browser:tab-opened': {
		description:
			'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
	},
	'browser:resize-requested': {
		description:
			"Fires when an agent asks to make the browser tab you see wider or narrower, with the width it asked for in Malini's pixels; Malini moves the divider between the chat and the inspector to match.",
	},
	'browser:thread-opened': {
		description:
			'Fires when you open the thread behind a pin on a page in the browser, with its workstream and chat; Malini shows that chat in a tab of its own. Malini does not keep it in its event log.',
		logged: false,
	},
	'extensions:file-open-requested': {
		description:
			"Fires when an agent opens a file for the user to edit, with the workstream, the file's path (relative to the worktree, or absolute outside it) and the line to show; Malini opens it in a File tab beside the workstream's chats.",
	},
	'stats:resources-sampled': {
		description:
			'Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use. Malini does not keep it in its event log.',
		logged: false,
	},
	'stats:workstream-running-changed': {
		description:
			'Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers. Malini does not keep it in its event log.',
		logged: false,
	},
};
