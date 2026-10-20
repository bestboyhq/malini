import { describe, expect, it } from 'vitest';
import type { PullRequestStatusDto } from '$contract/repositories';
import { ExtensionPullRequestMapper } from './extension-pull-request.mapper';

function baseStatus(): PullRequestStatusDto {
	return {
		state: 'open',
		number: 7,
		url: 'https://github.com/example/repo/pull/7',
		title: 'Ship it',
		draft: false,
		headRef: 'feature/ship',
		baseRef: 'main',
		headSha: 'abc123',
		includesLocalHead: null,
		mergeable: true,
		mergeableState: 'clean',
		behindBase: null,
		checksState: 'success',
		checks: [],
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'],
		defaultMergeMethod: 'squash',
		reviewDecision: 'approved',
		unresolvedReviewThreadCount: 0,
		updatedAt: '2026-07-22T08:00:00Z',
	};
}

describe('ExtensionPullRequestMapper.fromRaw', () => {
	it('maps behindBase through to the extension context', () => {
		const result = ExtensionPullRequestMapper.fromRaw({ ...baseStatus(), behindBase: 3 });
		expect(result.behindBase).toBe(3);
	});

	it('passes null behindBase through', () => {
		const result = ExtensionPullRequestMapper.fromRaw({ ...baseStatus(), behindBase: null });
		expect(result.behindBase).toBeNull();
	});

	it('treats a non-number behindBase as null', () => {
		const raw: PullRequestStatusDto = Object.assign(baseStatus(), { behindBase: 'not-a-number' });
		const result = ExtensionPullRequestMapper.fromRaw(raw);
		expect(result.behindBase).toBeNull();
	});
});
