import { describe, expect, it } from 'vitest';

import { failedOnRetiredWorkstream, unseenWarmFailures } from './extension-runtime-failure';

function retired(): Error {
	return Object.assign(new Error('Workstream `ws` was archived or deleted'), { kind: 'retired' });
}

describe('failedOnRetiredWorkstream', () => {
	it('finds a retirement behind wrapped and aggregated failures, and nothing else', () => {
		expect(failedOnRetiredWorkstream(new Error('wrapped', { cause: retired() }))).toBe(true);
		expect(
			failedOnRetiredWorkstream(new AggregateError([new Error('other'), retired()], 'cleanup')),
		).toBe(true);
		expect(failedOnRetiredWorkstream(new Error('wrapped', { cause: new Error('io') }))).toBe(false);
		expect(failedOnRetiredWorkstream('retired')).toBe(false);
	});
});

describe('unseenWarmFailures', () => {
	const bundled = { id: 'acme.bundled', error: new Error('crashed in a') };
	const community = { id: 'community.crashes', error: new Error('import failed') };
	const warm = { workstreamId: 'a', failed: [bundled, community] };
	const nothingRuns = { active: () => false, bundled: (id: string) => id === bundled.id };

	it('shows a bundled failure only in the workstream it was warmed for, a community one in any', () => {
		expect(unseenWarmFailures(warm, { workstreamId: 'b', failed: [] }, nothingRuns)).toEqual([
			community,
		]);
		expect(unseenWarmFailures(warm, { workstreamId: 'a', failed: [] }, nothingRuns)).toEqual([
			bundled,
			community,
		]);
	});

	it('drops what runs now and what the opened workstream reports itself', () => {
		const again = { id: bundled.id, error: new Error('crashed again') };

		expect(
			unseenWarmFailures(
				warm,
				{ workstreamId: 'a', failed: [again] },
				{ ...nothingRuns, active: (id) => id === community.id },
			),
		).toEqual([]);
	});
});
