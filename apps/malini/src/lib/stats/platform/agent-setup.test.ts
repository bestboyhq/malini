import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAgentSetup } from './agent-setup';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function write(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

function claudeHome(officialRepository: string): { settings: string; state: string } {
	const root = mkdtempSync(join(tmpdir(), 'malini-agent-setup-'));
	folders.push(root);
	const home = join(root, '.claude');
	const cloudflare = join(home, 'plugins', 'cache', 'claude-plugins-official', 'cloudflare');
	const svelte = join(home, 'plugins', 'cache', 'svelte', 'svelte');
	write(join(home, 'plugins', 'known_marketplaces.json'), {
		'claude-plugins-official': { source: { source: 'github', repo: officialRepository } },
		svelte: { source: { source: 'github', repo: 'sveltejs/ai-tools' } },
	});
	write(join(home, 'plugins', 'installed_plugins.json'), {
		version: 2,
		plugins: {
			'cloudflare@claude-plugins-official': [{ scope: 'user', installPath: cloudflare }],
			'svelte@svelte': [{ scope: 'user', installPath: svelte }],
			'caveman@caveman': [{ scope: 'user', installPath: join(home, 'missing') }],
		},
	});
	write(join(cloudflare, '.mcp.json'), {
		mcpServers: { 'cloudflare-docs': { type: 'http', url: 'https://docs.mcp.cloudflare.com/mcp' } },
	});
	write(join(cloudflare, '.claude-plugin', 'plugin.json'), {
		name: 'cloudflare',
		mcpServers: { extra: { command: 'npx', args: ['@cloudflare/extra'], env: { TOKEN: 'x' } } },
	});
	write(join(svelte, '.mcp.json'), { svelte: { type: 'http', url: 'https://mcp.svelte.dev/mcp' } });
	write(join(root, '.claude.json'), {
		mcpServers: {
			context7: {
				command: 'npx',
				args: ['@upstash/context7-mcp'],
				env: { KEY: 'x' },
			},
		},
		projects: {
			'/repo': { mcpServers: { stripe: { type: 'http', url: 'https://mcp.stripe.com/' } } },
		},
	});
	mkdirSync(join(home, 'skills', 'adr'), { recursive: true });
	return { settings: join(home, 'settings.json'), state: join(root, '.claude.json') };
}

describe('readAgentSetup', () => {
	it('counts plugins only from the official marketplace, and reads every plugin server from its install', async () => {
		const setup = await readAgentSetup(claudeHome('anthropics/claude-plugins-official'), []);

		expect(setup.plugins).toEqual(['cloudflare@claude-plugins-official']);
		expect(setup.localSkills).toEqual(['adr']);
		expect(setup.mcpServers).toEqual([
			{ key: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], url: null },
			{ key: 'stripe', command: null, args: [], url: 'https://mcp.stripe.com/' },
			{
				key: 'plugin_cloudflare_cloudflare-docs',
				command: null,
				args: [],
				url: 'https://docs.mcp.cloudflare.com/mcp',
			},
			{ key: 'plugin_cloudflare_extra', command: 'npx', args: ['@cloudflare/extra'], url: null },
			{ key: 'plugin_svelte_svelte', command: null, args: [], url: 'https://mcp.svelte.dev/mcp' },
		]);
	});

	it('counts no plugin when the official marketplace name points at another repository', async () => {
		const setup = await readAgentSetup(claudeHome('someone/claude-plugins-official'), []);

		expect(setup.plugins).toEqual([]);
	});
});
