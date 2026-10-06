import type { PullRequestMergeMethod } from './pull-request';

export type MergeConfirmation = Readonly<{
	pullRequestNumber: number;
	headSha: string;
	mergeMethod: PullRequestMergeMethod;
}>;

export type MergeConfirmationTarget = Readonly<{
	state: string;
	number: number | null;
	headSha?: string | null;
}>;

export type MergeConfirmationInput = Readonly<{
	expectedHeadSha: string;
	mergeMethod?: PullRequestMergeMethod;
}>;

export function mergeConfirmationKey(
	pullRequest: MergeConfirmationTarget | null | undefined,
): string | null {
	if (!pullRequest || pullRequest.number === null || !pullRequest.headSha) return null;
	return `#${pullRequest.number}@${pullRequest.headSha}`;
}

export function liveMergeConfirmation(
	request: MergeConfirmation | null,
	pullRequest: MergeConfirmationTarget | null | undefined,
): MergeConfirmation | null {
	if (!request) return null;
	if (!pullRequest || pullRequest.state !== 'open') return null;
	return mergeConfirmationKey(pullRequest) === `#${request.pullRequestNumber}@${request.headSha}`
		? request
		: null;
}

export function mergeConfirmationInput(
	request: MergeConfirmation | null,
): MergeConfirmationInput | undefined {
	if (!request) return undefined;
	return { expectedHeadSha: request.headSha, mergeMethod: request.mergeMethod };
}

export function mergeConfirmationDetail(request: MergeConfirmation): string {
	return `${mergeMethodLabel(request.mergeMethod)} #${request.pullRequestNumber} at ${shortHeadSha(request.headSha)}`;
}

function mergeMethodLabel(method: PullRequestMergeMethod): string {
	if (method === 'squash') return 'Squash and merge';
	if (method === 'rebase') return 'Rebase and merge';
	return 'Merge';
}

function shortHeadSha(headSha: string): string {
	return headSha.length > 7 ? headSha.slice(0, 7) : headSha;
}
