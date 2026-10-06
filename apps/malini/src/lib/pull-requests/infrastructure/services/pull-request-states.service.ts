import { extensionBindings } from '$shared/extensions/bindings';
import {
	PULL_REQUEST_STATE_REUSE_MS,
	type PullRequestState,
	type PullRequestTarget,
} from '$lib/pull-requests/domain/pull-request-state';
import { PullRequestStateMapper } from '$lib/pull-requests/infrastructure/mappers/pull-request-state.mapper';

export async function loadPullRequestStates(
	targets: readonly PullRequestTarget[],
): Promise<Readonly<Record<string, PullRequestState>>> {
	const settled = await Promise.allSettled(
		targets.map(async (target) => {
			const context = await extensionBindings
				.repository()
				.pullRequest(target.workstreamId, { maxAgeMs: PULL_REQUEST_STATE_REUSE_MS });
			const state: readonly [string, PullRequestState] = [
				target.workstreamId,
				PullRequestStateMapper.fromRaw(context),
			];
			return state;
		}),
	);
	return Object.fromEntries(
		settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
	);
}
