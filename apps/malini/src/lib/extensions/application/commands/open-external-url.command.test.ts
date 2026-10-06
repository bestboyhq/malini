import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { openExternalUrlCommand } from './open-external-url.command';

afterEach(() => {
	setPlatformForTest(null);
});

describe('openExternalUrlCommand', () => {
	it('opens web links in the system browser and ignores every other scheme', () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);

		openExternalUrlCommand('https://example.com/readme#usage');
		openExternalUrlCommand('http://example.com/');
		openExternalUrlCommand('file:///etc/passwd');
		openExternalUrlCommand('javascript:alert(1)');

		expect(fake.calls).toEqual([
			{ command: 'app.open-external-url', args: { url: 'https://example.com/readme#usage' } },
			{ command: 'app.open-external-url', args: { url: 'http://example.com/' } },
		]);
	});
});
