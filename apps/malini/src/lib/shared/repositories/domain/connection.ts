import type { GithubFailure, GithubReach } from '$contract/github-failure';

export type ConnectionProblem = Readonly<{ label: string; github: boolean }>;

export const GITHUB_PROBLEM_LABELS: Readonly<Record<GithubFailure, string>> = {
	unreachable: 'GitHub is not responding',
	down: 'GitHub is down',
	'rate-limited': 'GitHub rate limit reached',
};

export function connectionProblem(online: boolean, reach: GithubReach): ConnectionProblem | null {
	if (!online) return { label: 'Offline', github: false };
	if (reach === 'ok') return null;
	return { label: GITHUB_PROBLEM_LABELS[reach], github: reach !== 'rate-limited' };
}
