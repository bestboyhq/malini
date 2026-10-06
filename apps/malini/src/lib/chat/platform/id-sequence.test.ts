import { describe, expect, it } from 'vitest';

import { IdSequence } from './id-sequence';

describe('IdSequence', () => {
	it('stamps the prefix and the moment and never repeats a value', () => {
		const ids = new IdSequence();
		expect(ids.next('rule', 1700000000000)).toMatch(/^rule-1700000000000-\d+$/);
		expect(ids.next('run', 7)).toBe('run-7-1');
		expect(ids.next('sess')).not.toBe(ids.next('sess'));
	});

	it('counts independently per instance', () => {
		expect(new IdSequence().next('cmd', 5)).toBe(new IdSequence().next('cmd', 5));
	});
});
