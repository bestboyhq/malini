import type { IconName } from '$hyper-ui/icons';
import type { PullRequestActionKind } from '$lib/pull-requests/domain/pull-request-action';

const ACTION_ICONS: Readonly<Record<PullRequestActionKind, IconName>> = {
	'open-draft': 'pr-draft',
	'queue-merge': 'pr-merged',
	continue: 'branch',
	archive: 'archive',
	reopen: 'pr-open',
	'cancel-merge': 'close',
	'open-pull-request': 'external-link',
	'open-job': 'arrow-right',
	'open-github-status': 'external-link',
	reconnect: 'link',
	refresh: 'refresh',
	'abort-operation': 'undo',
};

export function pullRequestActionIcon(kind: PullRequestActionKind): IconName {
	return ACTION_ICONS[kind];
}
