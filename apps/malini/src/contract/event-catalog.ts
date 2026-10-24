import type { EventChannel } from './events';

export const EVENT_CATALOG: Readonly<Record<EventChannel, Readonly<{ description: string }>>> = {
	'chat:agent-event': {
		description:
			'Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order.',
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
	'chat:mcp-server-changed': {
		description:
			'Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.',
	},
	'chat:mcp-servers-listed': {
		description:
			'Fires while the MCP servers page is open, each time the Claude Code that watches a folder sees a server connect, fail, or change, with every server of that folder and whether any is still connecting.',
	},
	'repositories:workstream-created': {
		description:
			'Fires when a new workstream exists: its git worktree is checked out and it is ready for chats.',
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
			"Fires when merging a workstream's base branch into it stops on conflicts, with the base branch and the conflicted files.",
	},
	'repositories:clone-progress': {
		description:
			'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done.',
	},
	'repositories:changed': {
		description:
			'Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.',
	},
	'pull-requests:local-base-synced': {
		description:
			"Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.",
	},
	'pull-requests:ship-changed': {
		description:
			"Fires whenever a workstream's shipping state changes: its pull request phase, the merge queue step, or a reason it needs you.",
	},
	'jobs:run-changed': {
		description:
			'Fires whenever a job run waits for you, is queued, starts, needs you, or finishes as succeeded, failed or cancelled.',
	},
	'jobs:agent-action-changed': {
		description:
			"Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome.",
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
	'app:close-requested': {
		description:
			'Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.',
	},
	'app:scale-changed': {
		description:
			'Fires when the interface scale or the display the window sits on changes, so layouts can measure again.',
	},
	'app:notification-opened': {
		description: 'Fires when you click a Malini notification, with the chat it points to.',
	},
	'app:menu-command-chosen': {
		description:
			"Fires when you pick New Workstream, New Chat, Open Folder…, Clone Repository… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.",
	},
	'app:streaming-changed': {
		description:
			'Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.',
	},
	'app:updated': {
		description:
			'Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed.',
	},
	'app:update-staged': {
		description:
			'Fires when a new Malini version has downloaded and installs on the next restart, with that version.',
	},
	'browser:state-changed': {
		description:
			"Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure.",
	},
	'browser:tab-opened': {
		description:
			'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
	},
	'browser:resize-requested': {
		description:
			"Fires when an agent asks to make the browser tab you see wider or narrower, with the width it asked for in Malini's pixels; Malini moves the divider between the chat and the inspector to match.",
	},
	'stats:resources-sampled': {
		description:
			'Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use.',
	},
	'stats:workstream-running-changed': {
		description:
			'Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers.',
	},
};
