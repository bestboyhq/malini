import type { IconName } from '$hyper-ui/icons';
import type { PullRequestActionKind } from '$lib/pull-requests/domain/pull-request-action';

const ACTION_ICONS: Readonly<Record<PullRequestActionKind, IconName>> = {
	unavailable: 'plug',
	reconnect: 'link',
	operation: 'warning',
	'open-draft': 'pr-draft',
	'opening-draft': 'pr-draft',
	'queue-merge': 'pr-merged',
	queued: 'clock',
	'needs-you': 'alert',
};

export function pullRequestActionIcon(kind: PullRequestActionKind): IconName {
	return ACTION_ICONS[kind];
}
