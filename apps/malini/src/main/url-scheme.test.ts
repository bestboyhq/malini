import { describe, expect, it } from 'vitest';
import { claimsUrlScheme } from './url-scheme';

describe('claimsUrlScheme', () => {
	it('claims malini:// only for the dogfood Malini in front of you, never for tests or a plain dev run', () => {
		expect(claimsUrlScheme(false, { MALINI_DOGFOOD: '1' })).toBe(true);
		expect(claimsUrlScheme(false, {})).toBe(false);
		expect(claimsUrlScheme(false, { MALINI_DOGFOOD: '1', MALINI_BACKGROUND_WINDOW: '1' })).toBe(
			false,
		);
		expect(claimsUrlScheme(true, { MALINI_DOGFOOD: '1' })).toBe(false);
	});
});
