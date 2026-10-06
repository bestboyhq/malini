import { describe, expect, it } from 'vitest';
import { DbInvariantError } from '$main/errors';
import { bind, canonicalJson } from './rows';

describe('rows helpers', () => {
	it('binds booleans and undefined the way rusqlite did', () => {
		expect(bind([true, false, undefined, null, 'x', 3])).toEqual([1, 0, null, null, 'x', 3]);
		expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
		const error = new DbInvariantError('boom');
		expect(error.message).toBe('db invariant failed: boom');
		expect(error.detail).toBe('boom');
	});
});
