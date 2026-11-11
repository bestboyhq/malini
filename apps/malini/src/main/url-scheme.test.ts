import { describe, expect, it } from 'vitest';
import { claimsUrlScheme, urlInbox } from './url-scheme';

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

describe('urlInbox', () => {
	it('keeps the links that arrive before Malini is ready and opens them in order once it is', () => {
		const inbox = urlInbox();
		const opened: string[] = [];
		inbox.receive('malini://auth?code=early');
		inbox.receive('malini://auth?code=second');

		inbox.deliverTo((url) => opened.push(url));
		inbox.receive('malini://auth?code=late');

		expect(opened).toEqual([
			'malini://auth?code=early',
			'malini://auth?code=second',
			'malini://auth?code=late',
		]);
	});
});
