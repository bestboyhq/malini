import type { IconName } from '$hyper-ui/icons';
import type { PullRequestActionKind } from '$lib/pull-requests/domain/pull-request-action';

const ACTION_ICONS: Readonly<Record<PullRequestActionKind, IconName>> = {
	unavailable: 'plug',
	reconnect: 'link',
	retry: 'refresh',
	fix: 'wrench',
	push: 'arrow-up',
	update: 'branch',
	create: 'pr-open',
	ready: 'eye',
	todos: 'checklist',
	merge: 'pr-merged',
	merged: 'archive',
	open: 'external-link',
	'agent-running': 'sparkles',
	checking: 'clock',
	operation: 'warning',
	'no-changes': 'circle-slash',
};

export function pullRequestActionIcon(kind: PullRequestActionKind): IconName {
	return ACTION_ICONS[kind];
}
