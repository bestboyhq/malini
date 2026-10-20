import { describe, expect, it } from 'vitest';
import { toastDuration } from './toast-duration';

describe('how long a toast stays up', () => {
	it('keeps a null ttl up indefinitely instead of falling back to the default', () => {
		expect(toastDuration('Update ready', null, false)).toBe(Infinity);
	});

	it('spells an indefinite replacement as a finite duration sonner will honor', () => {
		const duration = toastDuration('Installed', null, true);

		expect(duration).toBeGreaterThan(0);
		expect(duration).toBeLessThan(Infinity);
	});

	it('scales an omitted ttl to how long the message takes to read, up to a cap', () => {
		const short = toastDuration('Saved', undefined, false);
		const long = toastDuration(
			'No GitHub token to send: could not read Username for https://github.com',
			undefined,
			false,
		);

		expect(long).toBeGreaterThan(short);
		expect(toastDuration('x'.repeat(1000), undefined, false)).toBe(8000);
	});

	it('honors an explicit ttl', () => {
		expect(toastDuration('Saved', 1200, false)).toBe(1200);
	});
});
