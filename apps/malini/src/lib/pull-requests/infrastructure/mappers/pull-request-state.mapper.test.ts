import type { ExtensionPullRequestCheck, ExtensionPullRequestContext } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';
import { PullRequestStateMapper } from './pull-request-state.mapper';

function pullRequest(
	overrides: Partial<ExtensionPullRequestContext> = {},
): ExtensionPullRequestContext {
	return {
		state: 'open',
		number: 7,
		title: 'Ship the workstream badge',
		url: 'https://github.com/acme/web/pull/7',
		baseBranch: 'main',
		headBranch: 'feature',
		headSha: 'abc1234',
		mergeable: true,
		mergeableState: 'clean',
		checks: 'success',
		checkItems: [],
		reviewDecision: 'approved',
		unresolvedReviewThreadCount: 0,
		...overrides,
	};
}

function check(overrides: Partial<ExtensionPullRequestCheck> = {}): ExtensionPullRequestCheck {
	return {
		name: 'Unit tests',
		appId: null,
		state: 'completed',
		conclusion: 'success',
		required: true,
		url: null,
		startedAt: null,
		completedAt: null,
		...overrides,
	};
}

describe('PullRequestStateMapper', () => {
	it('reports unknown rather than none when nothing can answer', () => {
		expect(PullRequestStateMapper.fromRaw(null)).toBe('unknown');
		expect(PullRequestStateMapper.fromRaw(undefined)).toBe('unknown');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ state: 'unavailable' }))).toBe('unknown');
		const unrecognizedLifecycle = Object.assign(pullRequest(), { state: 'something-newer' });
		expect(PullRequestStateMapper.fromRaw(unrecognizedLifecycle)).toBe('unknown');
	});

	it('maps the terminal and pre-review lifecycles straight through', () => {
		expect(PullRequestStateMapper.fromRaw(pullRequest({ state: 'not_open' }))).toBe('none');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ state: 'draft' }))).toBe('draft');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ state: 'merged' }))).toBe('merged');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ state: 'closed' }))).toBe('closed');
	});

	it('calls every published, non-draft pull request open, whatever its checks or review', () => {
		for (const overrides of [
			{},
			{ reviewDecision: 'changes_requested' as const },
			{ mergeable: false, mergeableState: 'dirty' },
			{ checks: 'failed' as const, checkItems: [check({ conclusion: 'failure' })] },
			{ checks: 'pending' as const },
		]) {
			expect(PullRequestStateMapper.fromRaw(pullRequest(overrides))).toBe('open');
		}
	});
});
