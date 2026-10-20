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
	'repositories:clone-progress': {
		description:
			'Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done.',
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
			'Fires whenever a job run is queued, starts, needs you, or finishes as succeeded, failed or cancelled.',
	},
	'jobs:definition-changed': {
		description:
			'Fires when a job is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.',
	},
	'routines:suggested': {
		description:
			'Fires when Malini notices a prompt you keep repeating and suggests turning it into a routine.',
	},
	'routines:changed': {
		description:
			'Fires when a routine is created, updated, promoted, demoted or deleted; `routine` is `null` after a delete.',
	},
	'routines:gated-run-changed': {
		description:
			'Fires when a routine run waits for your confirmation, and again when you confirm or reject it.',
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
			"Fires whenever a workstream's browser tab changes its page, title, icon, loading state or history.",
	},
	'browser:tab-opened': {
		description:
			'Fires when a new browser tab opens in a workstream, for example when an agent opens a page.',
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
