import { describe, expect, it } from 'vitest';
import { browserAddressLabel } from './browser-address';

describe('browser address label', () => {
	it('drops the scheme and a bare trailing slash so a narrow field shows the host first', () => {
		expect(browserAddressLabel('http://localhost:5201/')).toBe('localhost:5201');
		expect(browserAddressLabel('https://example.com/admin/media?tab=2#top')).toBe(
			'example.com/admin/media?tab=2#top',
		);
	});

	it('leaves anything that is not a web address as typed', () => {
		expect(browserAddressLabel('about:blank')).toBe('about:blank');
		expect(browserAddressLabel('')).toBe('');
	});
});
