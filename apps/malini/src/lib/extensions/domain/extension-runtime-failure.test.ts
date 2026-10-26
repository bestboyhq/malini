import { describe, expect, it } from 'vitest';

import { failedOnRetiredWorkstream } from './extension-runtime-failure';

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
