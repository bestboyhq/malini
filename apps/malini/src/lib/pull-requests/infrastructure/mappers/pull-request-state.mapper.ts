import type { ExtensionPullRequestContext } from '@malini/extension-api';
import {
	pullRequestStateOf,
	type PullRequestState,
} from '$lib/pull-requests/domain/pull-request-state';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';

export class PullRequestStateMapper {
	static fromRaw(pullRequest: ExtensionPullRequestContext | null | undefined): PullRequestState {
		return pullRequestStateOf(
			pullRequest ? RepositorySurfaceMapper.pullRequestFromRaw(pullRequest) : null,
		);
	}
}
