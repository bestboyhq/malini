import type { OwnPullRequestDto } from '$contract/repositories';

export type OwnPullRequest = OwnPullRequestDto;

export type OwnPullRequestsState =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'ready'; pullRequests: readonly OwnPullRequest[] }>
	| Readonly<{ status: 'failed'; error: string }>;
