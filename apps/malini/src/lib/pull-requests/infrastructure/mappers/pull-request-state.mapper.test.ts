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

	it('calls a pull request ready only when checks, review, and mergeability all agree', () => {
		expect(PullRequestStateMapper.fromRaw(pullRequest())).toBe('ready');
		expect(
			PullRequestStateMapper.fromRaw(
				pullRequest({ checks: 'failed', checkItems: [check(), check({ name: 'Lint' })] }),
			),
		).toBe('ready');
	});

	it('does not call a pull request ready on green checks alone', () => {
		expect(
			PullRequestStateMapper.fromRaw(pullRequest({ reviewDecision: 'changes_requested' })),
		).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ reviewDecision: 'review_required' }))).toBe(
			'open',
		);
		expect(PullRequestStateMapper.fromRaw(pullRequest({ unresolvedReviewThreadCount: 2 }))).toBe(
			'open',
		);
		expect(PullRequestStateMapper.fromRaw(pullRequest({ unresolvedReviewThreadCount: null }))).toBe(
			'open',
		);
		expect(PullRequestStateMapper.fromRaw(pullRequest({ mergeable: false }))).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ mergeableState: 'blocked' }))).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ mergeableState: 'dirty' }))).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ mergeableState: 'behind' }))).toBe('open');
	});

	it('keeps pending, unknown, and absent checks on open', () => {
		expect(PullRequestStateMapper.fromRaw(pullRequest({ checks: 'pending' }))).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ checks: 'unknown' }))).toBe('open');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ checks: 'none' }))).toBe('open');
		expect(
			PullRequestStateMapper.fromRaw(pullRequest({ checks: 'unknown', checkItems: [check()] })),
		).toBe('open');
		expect(
			PullRequestStateMapper.fromRaw(
				pullRequest({
					checks: 'pending',
					checkItems: [check({ state: 'in_progress', conclusion: null })],
				}),
			),
		).toBe('open');
	});

	it('reports failing only for a genuinely blocking failed check', () => {
		expect(
			PullRequestStateMapper.fromRaw(
				pullRequest({
					checks: 'failed',
					checkItems: [check({ state: 'completed', conclusion: 'failure' })],
				}),
			),
		).toBe('failing');
		expect(
			PullRequestStateMapper.fromRaw(
				pullRequest({
					checks: 'failed',
					checkItems: [check({ required: null, state: 'failure', conclusion: null })],
				}),
			),
		).toBe('failing');
		expect(PullRequestStateMapper.fromRaw(pullRequest({ checks: 'failed', checkItems: [] }))).toBe(
			'failing',
		);
		expect(
			PullRequestStateMapper.fromRaw(
				pullRequest({
					checks: 'failed',
					checkItems: [check({ required: false, state: 'completed', conclusion: 'failure' })],
				}),
			),
		).not.toBe('failing');
	});
});
