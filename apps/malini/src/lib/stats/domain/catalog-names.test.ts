import { describe, expect, it } from 'vitest';
import { catalogNames, parseCatalog, type LocalMcpServer } from './catalog-names';

const CATALOG = parseCatalog({
	updated: '2026-10-29',
	skills: ['code-review', 'dataviz'],
	plugins: [
		{
			id: 'cloudflare@claude-plugins-official',
			skills: ['wrangler'],
			mcpServers: ['cloudflare-api', 'cloudflare-docs'],
		},
		{ id: 'posthog@claude-plugins-official', skills: ['insights'], mcpServers: [] },
		{ id: 42 },
	],
	mcpServers: [
		{
			name: 'io.github.upstash/context7',
			packages: ['@upstash/context7-mcp'],
			remotes: ['https://mcp.context7.com/mcp'],
		},
		{
			name: 'com.cloudflare.mcp/mcp',
			packages: [],
			remotes: ['https://docs.mcp.cloudflare.com/mcp', 'https://builds.mcp.cloudflare.com/mcp'],
		},
		{ name: 'dev.svelte/mcp', packages: [], remotes: ['https://mcp.svelte.dev/mcp'] },
		{ name: 'com.example/nothing-to-match', packages: [], remotes: [] },
	],
});

function remote(key: string, url: string): LocalMcpServer {
	return { key, command: null, args: [], url };
}

function command(key: string, run: string, args: readonly string[]): LocalMcpServer {
	return { key, command: run, args, url: null };
}

const names = catalogNames(CATALOG, {
	plugins: ['cloudflare@claude-plugins-official'],
	localSkills: ['dataviz'],
	mcpServers: [
		remote('plugin_cloudflare_cloudflare-docs', 'https://docs.mcp.cloudflare.com/mcp'),
		remote('plugin_cloudflare_cloudflare-api', 'https://mcp.cloudflare.com/mcp'),
		remote('plugin_svelte_svelte', 'https://mcp.svelte.dev/mcp'),
		command('context7', 'npx', ['-y', '@upstash/context7-mcp@latest']),
		command('docs', 'npx', ['mcp-remote', 'https://mcp.context7.com/mcp/']),
		remote('cloudflare builds', 'https://builds.mcp.cloudflare.com/mcp'),
		command('context7-lookalike', 'node', ['./context7.js']),
		command('cloudflare-docs', 'node', ['./docs.js']),
		command('twice', 'npx', ['@upstash/context7-mcp']),
		command('twice', 'node', ['./mine.js']),
	],
});

describe('catalogNames', () => {
	it('names a built-in skill only when no skill of yours shares its name', () => {
		expect(names.skill('code-review')).toBe('code-review');
		expect(names.skill('dataviz')).toBe('other');
		expect(names.skill('adr')).toBe('other');
	});

	it('names a plugin skill only when the plugin came from the official marketplace and the catalog lists the skill', () => {
		expect(names.skill('cloudflare:wrangler')).toBe('cloudflare:wrangler');
		expect(names.skill('cloudflare:my-own')).toBe('other');
		expect(names.skill('posthog:insights')).toBe('other');
		expect(names.skill('svelte:svelte-code-writer')).toBe('other');
	});

	it('gives each MCP server one name: malini, then a registry match, then the plugin name, then other', () => {
		expect(names.mcpServer('Bash')).toBeNull();
		expect(names.mcpServer('mcp__malini__browser_open')).toBe('malini');
		expect(names.mcpServer('mcp__plugin_cloudflare_cloudflare-docs__search')).toBe(
			'com.cloudflare.mcp/mcp',
		);
		expect(names.mcpServer('mcp__plugin_svelte_svelte__svelte-autofixer')).toBe('dev.svelte/mcp');
		expect(names.mcpServer('mcp__plugin_cloudflare_cloudflare-api__execute')).toBe(
			'cloudflare:cloudflare-api',
		);
		expect(names.mcpServer('mcp__context7__resolve-library-id')).toBe('io.github.upstash/context7');
		expect(names.mcpServer('mcp__docs__query')).toBe('io.github.upstash/context7');
		expect(names.mcpServer('mcp__cloudflare_builds__get_build')).toBe('com.cloudflare.mcp/mcp');
	});

	it('counts a local server that only shares a catalog name as other', () => {
		expect(names.mcpServer('mcp__context7-lookalike__query')).toBe('other');
		expect(names.mcpServer('mcp__cloudflare-docs__search')).toBe('other');
		expect(names.mcpServer('mcp__twice__query')).toBe('other');
		expect(names.mcpServer('mcp__claude_ai_Claude_Docs__read')).toBe('other');
	});

	it('keeps only what matching needs and names nothing without a catalog', () => {
		expect(CATALOG?.mcpServers.map(({ name }) => name)).not.toContain(
			'com.example/nothing-to-match',
		);
		const none = catalogNames(null, { plugins: [], localSkills: [], mcpServers: [] });
		expect(none.skill('code-review')).toBe('other');
		expect(none.mcpServer('mcp__context7__query')).toBe('other');
		expect(parseCatalog({ skills: [] })).toBeNull();
	});
});
