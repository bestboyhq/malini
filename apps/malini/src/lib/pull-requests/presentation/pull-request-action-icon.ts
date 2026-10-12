import type { IconName } from '$hyper-ui/icons';
import type { PullRequestActionKind } from '$lib/pull-requests/domain/pull-request-action';

const ACTION_ICONS: Readonly<Record<PullRequestActionKind, IconName>> = {
	'open-draft': 'pr-draft',
	'queue-merge': 'pr-merged',
	'cancel-merge': 'close',
	'open-pull-request': 'external-link',
	'open-job': 'arrow-right',
	reconnect: 'link',
	refresh: 'refresh',
	'abort-operation': 'undo',
};

export function pullRequestActionIcon(kind: PullRequestActionKind): IconName {
	return ACTION_ICONS[kind];
}
