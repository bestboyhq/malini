import { describe, expect, it } from 'vitest';
import { replyFix } from './reply-check.js';

describe('replyFix', () => {
	it('sends a reply back only with what to fix', () => {
		expect(replyFix({ ok: false, fix: ' "isn\'t" is a contraction. ' })).toBe(
			'"isn\'t" is a contraction.',
		);
	});

	it('lets a reply through on a pass, a fail with nothing to fix, or an answer of another shape', () => {
		expect(replyFix({ ok: true })).toBeNull();
		expect(replyFix({ ok: true, fix: 'Shorter.' })).toBeNull();
		expect(replyFix({ ok: false })).toBeNull();
		expect(replyFix({ ok: false, fix: '  ' })).toBeNull();
		expect(replyFix({ ok: 'false', fix: 'Shorter.' })).toBeNull();
		expect(replyFix(null)).toBeNull();
	});
});
