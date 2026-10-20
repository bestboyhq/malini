import { describe, expect, it } from 'vitest';

import { bundledExtensions } from './bundled-extensions';

describe('bundled extension catalog', () => {
	it('contains the repository package exactly once', () => {
		expect(bundledExtensions.map(({ manifest }) => manifest.id)).toEqual(['malini.repository']);
		expect(new Set(bundledExtensions.map(({ manifest }) => manifest.id)).size).toBe(1);
	});

	it('grants trust without changing the public lifecycle contract', () => {
		for (const extension of bundledExtensions) {
			expect(extension.trusted).toBe(true);
			expect(typeof extension.module.activate).toBe('function');
			expect(extension.manifest.apiVersion).toBe(1);
		}
	});

	it('keeps repository-custom machinery opt-in through .malini/workspace.json', () => {
		expect(
			Object.fromEntries(
				bundledExtensions.map(({ manifest, activation }) => [manifest.id, activation]),
			),
		).toEqual({
			'malini.repository': 'built-in',
		});
	});
});
