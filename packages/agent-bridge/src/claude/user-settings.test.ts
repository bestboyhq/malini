import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowInUserSettings } from './user-settings.js';

describe('allowInUserSettings', () => {
	let home = '';
	const settings = (): string => join(home, 'settings.json');
	const read = async (path = settings()): Promise<unknown> =>
		JSON.parse(await readFile(path, 'utf8'));

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), 'malini-user-settings-'));
		vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, 'claude'));
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(home, { recursive: true, force: true });
	});

	it('creates the settings file with the rule when there is none', async () => {
		await allowInUserSettings('mcp__ops__set_member_role');

		expect(await read(join(home, 'claude', 'settings.json'))).toEqual({
			permissions: { allow: ['mcp__ops__set_member_role'] },
		});
	});

	it('adds the rule once, keeps everything else, and writes through a symlink', async () => {
		vi.stubEnv('CLAUDE_CONFIG_DIR', home);
		const dotfile = join(home, 'dotfiles-settings.json');
		await writeFile(
			dotfile,
			JSON.stringify({ model: 'opus', permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] } }),
		);
		await symlink(dotfile, settings());

		await allowInUserSettings('WebFetch(domain:example.com)');
		await allowInUserSettings('WebFetch(domain:example.com)');

		expect(await read(dotfile)).toEqual({
			model: 'opus',
			permissions: { allow: ['Read', 'WebFetch(domain:example.com)'], deny: ['Bash(rm:*)'] },
		});
	});

	it('leaves a settings file it cannot read alone', async () => {
		vi.stubEnv('CLAUDE_CONFIG_DIR', home);
		await writeFile(settings(), '{ "model": ');

		await expect(allowInUserSettings('Read')).rejects.toThrow('is not valid JSON');
		expect(await readFile(settings(), 'utf8')).toBe('{ "model": ');
	});
});
