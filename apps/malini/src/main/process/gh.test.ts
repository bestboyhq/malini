import { describe, expect, it } from 'vitest';
import { withBundledGh } from './gh';

describe('withBundledGh', () => {
	it('puts the gh malini ships after every directory on the PATH, so a user’s own gh wins', () => {
		expect(
			withBundledGh('/opt/homebrew/bin:/usr/bin', '/Applications/malini.app/Contents/Resources'),
		).toBe('/opt/homebrew/bin:/usr/bin:/Applications/malini.app/Contents/Resources/vendor/gh/bin');
		expect(withBundledGh(undefined, '/resources')).toBe('/resources/vendor/gh/bin');
	});
});
