import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MainContext } from '$main/context';
import { openDatabase } from '$main/db/driver';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerProviders, type ProvidersDeps } from './register';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function boot(deps: ProvidersDeps) {
	const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-providers-'));
	roots.push(appDataRoot);
	const commands = new CommandRegistry();
	const context: MainContext = {
		db: openDatabase(':memory:'),
		commands,
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	registerProviders(context, deps);
	return {
		appDataRoot,
		invoke: (args: unknown) => commands.invoke({ command: 'providers.run-claude-setup', args }),
	};
}

describe('providers.run-claude-setup', () => {
	it('opens an executable Terminal script that runs the Claude Code step, and only on macOS', async () => {
		const opened: string[] = [];
		const mac = boot({
			platform: 'darwin',
			openPath: async (path) => {
				opened.push(path);
				return '';
			},
		});

		expect(await mac.invoke({ step: 'sign-in' })).toEqual({ ok: true, value: null });
		expect(await mac.invoke({ step: 'install' })).toEqual({ ok: true, value: null });

		expect(opened).toEqual([
			join(mac.appDataRoot, 'claude-setup', 'sign-in.command'),
			join(mac.appDataRoot, 'claude-setup', 'install.command'),
		]);
		expect(readFileSync(opened[0] ?? '', 'utf8')).toBe(
			'#!/bin/sh\nexport PATH="$HOME/.local/bin:$PATH"\nclaude auth login\n',
		);
		expect(readFileSync(opened[1] ?? '', 'utf8')).toContain(
			'curl -fsSL https://claude.ai/install.sh | bash\n',
		);
		expect(statSync(opened[1] ?? '').mode & 0o777).toBe(0o700);
		expect(await mac.invoke({ step: 'uninstall' })).toEqual({
			ok: false,
			error: 'invalid args: `step` must be `install` or `sign-in`',
		});

		const linux = boot({ platform: 'linux', openPath: () => Promise.reject(new Error('opened')) });
		expect(await linux.invoke({ step: 'sign-in' })).toEqual({
			ok: false,
			error: 'Run `claude auth login` in a terminal, then check again.',
		});
	});
});
