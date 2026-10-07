import type {
	PullRequestActionKind,
	PullRequestAvailability,
	PullRequestTopBarPresentation,
} from './pull-request-action';
import { pullRequestTopBarPresentation } from './pull-request-top-bar';
import type { RepositorySurface } from './repository-surface';

export type DeferredPullRequestActionVerdict = 'wait' | 'run' | 'drop';

export type ClickedPullRequestAction = Readonly<{
	kind: PullRequestActionKind;
	label: string;
	ariaLabel: string;
	clickedAt: number;
	headSha: string | null;
}>;

export const DEFERRED_PULL_REQUEST_ACTION_TTL_MS = 8_000;

export function deferredPullRequestActionVerdict(input: {
	surface: RepositorySurface | null;
	clicked: ClickedPullRequestAction;
	availability: PullRequestAvailability;
}): DeferredPullRequestActionVerdict {
	const { surface, clicked } = input;
	if (!surface) return 'wait';
	if (surface.pullRequestRefreshStatus === 'error') {
		return happenedSince(surface.pullRequestSettledAt, clicked.clickedAt) ? 'drop' : 'wait';
	}
	if (surface.status !== 'ready' && surface.status !== 'empty') return 'wait';
	if (surface.pullRequestRefreshStatus !== 'ready') return 'wait';
	if (!happenedSince(surface.pullRequestRefreshedAt, clicked.clickedAt)) return 'wait';
	const presentation = pullRequestTopBarPresentation(surface, input.availability);
	const headSha = surface.pullRequest?.headSha ?? null;
	return presentation && sameAction(presentation, clicked, headSha) ? 'run' : 'drop';
}

function happenedSince(time: number | null, since: number): boolean {
	return time !== null && time >= since;
}

function sameAction(
	presentation: PullRequestTopBarPresentation,
	clicked: ClickedPullRequestAction,
	headSha: string | null,
): boolean {
	return (
		!presentation.disabled &&
		presentation.kind === clicked.kind &&
		presentation.label === clicked.label &&
		presentation.ariaLabel === clicked.ariaLabel &&
		(presentation.kind !== 'merge' || headSha === clicked.headSha)
	);
}
