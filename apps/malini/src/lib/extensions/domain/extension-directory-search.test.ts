import { describe, expect, it } from 'vitest';

import type { ExtensionDirectoryEntry } from './extension-directory-entry';
import { searchExtensionDirectory } from './extension-directory-search';

describe('extension directory search', () => {
	it('searches metadata and prefers first-party entries', () => {
		const community = entry({ id: 'acme.preview', name: 'Acme Preview', tags: ['browser'] });
		const terminal = entry({
			id: 'example.terminal',
			name: 'Terminal',
			tags: ['shell'],
			firstParty: true,
		});
		expect(searchExtensionDirectory([community, terminal], '')).toEqual([terminal, community]);
		expect(searchExtensionDirectory([community, terminal], 'acme browser')).toEqual([community]);
		expect(searchExtensionDirectory([community, terminal], 'missing')).toEqual([]);
	});
});

function entry(overrides: Partial<ExtensionDirectoryEntry> = {}): ExtensionDirectoryEntry {
	return {
		id: 'acme.extension',
		name: 'Acme Extension',
		summary: 'A tested extension.',
		publisher: 'Acme',
		author: { name: 'Ada', url: 'https://github.com/ada' },
		funding: [],
		source: { repositoryUrl: 'https://github.com/acme/extension', license: 'MIT' },
		readme: {
			markdown: '# Acme Extension\n\nUseful documentation.',
			sourceUrl: 'https://github.com/acme/extension/blob/main/README.md',
		},
		review: {
			status: 'approved',
			reviewer: 'malini directory',
			reviewedAt: '2026-07-12T00:00:00Z',
			url: 'https://github.com/acme/extension/pull/1',
		},
		tests: {
			contract: passed(),
			unit: passed(),
			scenario: passed(),
			native: { status: 'not-provided' },
		},
		tags: ['developer tools'],
		...overrides,
	};
}

function passed() {
	return {
		status: 'passed' as const,
		reportUrl: 'https://github.com/acme/extension/actions/1',
		verifiedAt: '2026-07-12T00:00:00Z',
	};
}
