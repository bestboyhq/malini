import { describe, expect, it } from 'vitest';
import { browserProfileName } from '$contract/browser';
import { openMigratedDatabase } from '$main/db/open';
import { listBrowserProfiles, rememberBrowserProfile } from './profiles';

describe('browser profiles', () => {
	it('remembers each profile a tab used once, in name order, and leaves the default out', () => {
		const db = openMigratedDatabase(':memory:');

		rememberBrowserProfile(db, 'reddit-dogs');
		rememberBrowserProfile(db, 'default');
		rememberBrowserProfile(db, 'reddit-cats');
		rememberBrowserProfile(db, 'reddit-dogs');

		expect(listBrowserProfiles(db)).toEqual(['reddit-cats', 'reddit-dogs']);
	});

	it('turns what a person or an agent types into a profile name, or refuses it', () => {
		expect(browserProfileName('  Reddit Cats ')).toBe('reddit-cats');
		expect(browserProfileName('work_account--2')).toBe('work-account-2');
		expect(browserProfileName('Café')).toBe('cafe');
		for (const refused of ['', '   ', '!!!', '-', 'a'.repeat(33)]) {
			expect(browserProfileName(refused)).toBeNull();
		}
	});
});
