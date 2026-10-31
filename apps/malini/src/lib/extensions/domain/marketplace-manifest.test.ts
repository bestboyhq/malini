import { describe, expect, it } from 'vitest';
import {
	isNewerVersion,
	packageProblem,
	readMarketplaceManifest,
	serverHosts,
	skillsIn,
	type MarketplaceManifest,
} from './marketplace-manifest';

const SVELTE = {
	apiVersion: 2,
	publisher: 'szymeo',
	name: 'svelte',
	version: '1.0.4',
	displayName: ' Svelte ',
	description: 'Svelte 5 docs, the autofixer and best-practice skills, for every agent.',
	repository: 'https://github.com/sveltejs/ai-tools',
	contributes: { mcpServers: { svelte: { url: 'https://mcp.svelte.dev/mcp' } } },
};

const MANIFEST: MarketplaceManifest = {
	publisher: 'szymeo',
	name: 'svelte',
	version: '1.0.4',
	displayName: 'Svelte',
	description: SVELTE.description,
	repository: SVELTE.repository,
	mcpServers: [{ name: 'svelte', url: 'https://mcp.svelte.dev/mcp' }],
};

describe('readMarketplaceManifest', () => {
	it('reads a manifest and trims its words', () => {
		expect(readMarketplaceManifest(SVELTE)).toEqual({ manifest: MANIFEST, problem: null });
	});

	it('takes null for an optional key', () => {
		expect(
			readMarketplaceManifest({ ...SVELTE, repository: null, contributes: { mcpServers: null } })
				.manifest,
		).toEqual({ ...MANIFEST, repository: null, mcpServers: [] });
	});

	it('counts a name in characters, not code units', () => {
		expect(readMarketplaceManifest({ ...SVELTE, displayName: '🔥'.repeat(40) }).problem).toBeNull();
		expect(
			readMarketplaceManifest({ ...SVELTE, displayName: '🔥'.repeat(41) }).problem?.field,
		).toBe('displayName');
	});

	it.each([
		[{ ...SVELTE, apiVersion: 1 }, 'apiVersion'],
		[{ ...SVELTE, publisher: 'Szymeo' }, 'publisher'],
		[{ ...SVELTE, publisher: 'a--b' }, 'publisher'],
		[{ ...SVELTE, name: 'x'.repeat(40) }, 'name'],
		[{ ...SVELTE, version: '1.02.0' }, 'version'],
		[{ ...SVELTE, version: '1.0.0-beta' }, 'version'],
		[{ ...SVELTE, version: '9007199254740992.0.0' }, 'version'],
		[{ ...SVELTE, displayName: '   ' }, 'displayName'],
		[{ ...SVELTE, description: 'line\nbreak' }, 'description'],
		[{ ...SVELTE, repository: 'http://github.com/x/y' }, 'repository'],
		[{ ...SVELTE, homepage: 'https://svelte.dev' }, 'homepage'],
		[{ ...SVELTE, contributes: { hooks: {} } }, 'contributes.hooks'],
		[
			{ ...SVELTE, contributes: { mcpServers: { svelte: { command: 'npx' } } } },
			'contributes.mcpServers.svelte.command',
		],
		[
			{ ...SVELTE, contributes: { mcpServers: { svelte: { url: 'http://mcp.svelte.dev' } } } },
			'contributes.mcpServers.svelte.url',
		],
		[
			{ ...SVELTE, contributes: { mcpServers: { Svelte: { url: 'https://mcp.svelte.dev' } } } },
			'contributes.mcpServers.Svelte',
		],
	])('refuses %o at %s', (manifest, field) => {
		expect(readMarketplaceManifest(manifest).problem?.field).toBe(field);
	});
});

describe('packageProblem', () => {
	const files = (...paths: string[]): { path: string; size: number }[] =>
		paths.map((path) => ({ path, size: 10 }));

	it('accepts the manifest, a readme, a license and skill folders', () => {
		expect(
			packageProblem(
				files('malini.json', 'README.md', 'LICENSE', 'skills/runes/SKILL.md', 'skills/runes/x.md'),
				MANIFEST,
			),
		).toBeNull();
	});

	it('accepts the file names real skills use', () => {
		expect(
			packageProblem(
				files(
					'malini.json',
					'skills/svelte-core-bestpractices/SKILL.md',
					'skills/svelte-core-bestpractices/references/@attach.md',
					'skills/svelte-core-bestpractices/references/$inspect.md',
				),
				MANIFEST,
			),
		).toBeNull();
	});

	it.each([
		[files('README.md', 'skills/a/SKILL.md'), 'files'],
		[files('malini.json', '../escape'), 'files[1].path'],
		[files('malini.json', 'skills//SKILL.md'), 'files[1].path'],
		[files('malini.json', 'bin/server.js'), 'files[1].path'],
		[files('malini.json', 'skills/Runes/SKILL.md'), 'files[1].path'],
		[files('malini.json', 'malini.json'), 'files[1].path'],
		[files('malini.json', 'skills/a/SKILL.md', 'skills/a/skill.md'), 'files[2].path'],
		[files('malini.json', 'skills/a/SKILL.md', 'skills/a/my notes.md'), 'files[2].path'],
		[files('malini.json', 'skills/a/SKILL.md', 'skills/a/SKILL.md/x.md'), 'files[2].path'],
		[
			files('malini.json', 'skills/a/SKILL.md', 'skills/a/notes/x.md', 'skills/a/notes'),
			'files[3].path',
		],
		[files('malini.json', `skills/a/${'x'.repeat(256)}.md`), 'files[1].path'],
		[files('malini.json', `skills/a/${'x/'.repeat(520)}SKILL.md`), 'files[1].path'],
		[files('malini.json', 'skills/runes/notes.md'), 'files'],
	])('refuses %o at %s', (entries, field) => {
		expect(packageProblem(entries, MANIFEST)?.field).toBe(field);
	});

	it('refuses a readme over 64 KB', () => {
		expect(
			packageProblem([...files('malini.json'), { path: 'README.md', size: 65_537 }], MANIFEST),
		).toEqual({ field: 'files[1].path', error: 'README.md is at most 64 KB.' });
	});

	it('needs a server or a skill', () => {
		expect(packageProblem(files('malini.json'), { ...MANIFEST, mcpServers: [] })?.error).toBe(
			'An extension needs at least one MCP server or one skill.',
		);
	});
});

describe('skillsIn', () => {
	it('names each skill folder once, sorted', () => {
		expect(
			skillsIn([
				{ path: 'skills/runes/SKILL.md', size: 1 },
				{ path: 'skills/autofixer/SKILL.md', size: 1 },
				{ path: 'skills/runes/reference.md', size: 1 },
				{ path: 'README.md', size: 1 },
			]),
		).toEqual(['autofixer', 'runes']);
	});
});

describe('isNewerVersion', () => {
	it.each([
		['1.0.10', '1.0.9', true],
		['2.0.0', '1.99.99', true],
		['1.0.0', '1.0.0', false],
		['0.9.0', '1.0.0', false],
	])('%s over %s is %s', (candidate, current, newer) => {
		expect(isNewerVersion(candidate, current)).toBe(newer);
	});
});

describe('serverHosts', () => {
	it('names each host once', () => {
		expect(
			serverHosts([
				{ name: 'api', url: 'https://mcp.cloudflare.com/mcp' },
				{ name: 'docs', url: 'https://docs.mcp.cloudflare.com/mcp' },
				{ name: 'again', url: 'https://mcp.cloudflare.com/sse' },
			]),
		).toEqual(['docs.mcp.cloudflare.com', 'mcp.cloudflare.com']);
	});
});
