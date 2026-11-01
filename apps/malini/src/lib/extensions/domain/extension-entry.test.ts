import { describe, expect, it } from 'vitest';
import type { ExtensionListing, InstalledExtension } from '$contract/marketplace';
import { discoverEntries, entryMatches, installedEntries } from './extension-entry';

const NEON: ExtensionListing = {
	publisher: 'neon',
	name: 'neon',
	displayName: 'Neon',
	description: 'Postgres with branching.',
	version: '2.1.2',
	publishedOn: '2026-10-21',
	repository: null,
	mcpServers: [{ name: 'neon', url: 'https://mcp.neon.tech/mcp' }],
	skills: ['neon-postgres'],
};

const INSTALLED_NEON: InstalledExtension = {
	publisher: 'neon',
	name: 'neon',
	displayName: 'Neon',
	description: 'Postgres with branching.',
	version: '2.1.0',
	repository: null,
	mcpServers: [{ name: 'neon', url: 'https://mcp.neon.tech/mcp' }],
	skills: ['neon-postgres'],
	enabled: true,
	withdrawn: false,
	installedAt: '2026-10-30T10:00:00.000Z',
};

describe('discoverEntries', () => {
	it('marks what is installed and offers the newer version', () => {
		const [entry] = discoverEntries([NEON], [INSTALLED_NEON]);
		expect(entry?.installed).toBe(INSTALLED_NEON);
		expect(entry?.update).toEqual({ version: '2.1.2', newHosts: [] });
		expect(entry?.version).toBe('2.1.2');
	});

	it('names the hosts a newer version reaches that yours does not', () => {
		const wider = {
			...NEON,
			mcpServers: [...NEON.mcpServers, { name: 'console', url: 'https://console.neon.tech/mcp' }],
		};
		expect(discoverEntries([wider], [INSTALLED_NEON])[0]?.update?.newHosts).toEqual([
			'console.neon.tech',
		]);
	});

	it('offers nothing for an extension that is not installed', () => {
		expect(discoverEntries([NEON], [])[0]).toMatchObject({ installed: null, update: null });
	});
});

describe('installedEntries', () => {
	it('shows the installed version and the update the marketplace has', () => {
		const [entry] = installedEntries([INSTALLED_NEON], [NEON]);
		expect(entry?.version).toBe('2.1.0');
		expect(entry?.update?.version).toBe('2.1.2');
	});

	it('keeps an extension the marketplace no longer lists', () => {
		expect(installedEntries([INSTALLED_NEON], [])[0]?.update).toBeNull();
	});
});

describe('entryMatches', () => {
	const [entry] = discoverEntries([NEON], []);

	it.each([
		['', true],
		['postgres', true],
		['@neon', true],
		['neon-postgres', true],
		['branching neon', true],
		['mysql', false],
	])('%s matches: %s', (query, matched) => {
		expect(entry && entryMatches(entry, query)).toBe(matched);
	});
});
