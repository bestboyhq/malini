import { describe, expect, it } from 'vitest';
import { optionalPublicEnv, publicEnv, readPublicEnv } from './public-env';

describe('public environment', () => {
	it('reads a PUBLIC_ key through the renderer prefix Vite exposes', () => {
		expect(readPublicEnv('PUBLIC_PLATFORM', { RENDERER_VITE_PLATFORM: 'fake' })).toBe('fake');
	});

	it('falls back to the generic Vite prefix, then to the bare key', () => {
		expect(readPublicEnv('PUBLIC_PLATFORM', { VITE_PLATFORM: 'fake' })).toBe('fake');
		expect(readPublicEnv('PUBLIC_PLATFORM', { PUBLIC_PLATFORM: 'fake' })).toBe('fake');
	});

	it('prefers the renderer prefix when several spellings are present', () => {
		expect(
			readPublicEnv('PUBLIC_PLATFORM', {
				RENDERER_VITE_PLATFORM: 'renderer',
				VITE_PLATFORM: 'vite',
				PUBLIC_PLATFORM: 'bare',
			}),
		).toBe('renderer');
	});

	it('returns the fallback for an optional key that is unset or empty', () => {
		expect(optionalPublicEnv('PUBLIC_PLATFORM', 'electron', {})).toBe('electron');
		expect(optionalPublicEnv('PUBLIC_PLATFORM', 'electron', { VITE_PLATFORM: '' })).toBe(
			'electron',
		);
	});

	it('names the missing key when a required value is absent', () => {
		expect(() => publicEnv('PUBLIC_PLATFORM', {})).toThrow(
			'Missing public environment variable: PUBLIC_PLATFORM',
		);
	});
});
