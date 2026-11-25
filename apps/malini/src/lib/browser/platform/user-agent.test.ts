import { describe, expect, it } from 'vitest';
import { chromeUserAgent } from './user-agent';

const CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

describe('chromeUserAgent', () => {
	it.each([
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Malini/0.1.0 Chrome/152.0.7977.169 Electron/44.11.3 Safari/537.36',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.169 Electron/44.11.3 Safari/537.36',
		CHROME,
	])('reads as Chrome from %s', (electronUserAgent) => {
		expect(chromeUserAgent(electronUserAgent)).toBe(CHROME);
	});
});
