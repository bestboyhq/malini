import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MainContext } from '$main/context';
import { openDatabase } from '$main/db/driver';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerProviders, type ProvidersDeps } from './register';

const roots: string[] = [];
const stops: Array<() => void> = [];

afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function boot(deps: ProvidersDeps = {}) {
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
	const providers = registerProviders(context, deps);
	stops.push(() => providers.stop());
	return { appDataRoot, commands };
}

function shellEnvironment(): Record<string, string> {
	return { PATH: '/usr/bin:/bin' };
}

function fakeClaude(body: string): { executable: string; argsFile: string } {
	const directory = mkdtempSync(join(tmpdir(), 'malini-fake-claude-'));
	roots.push(directory);
	const executable = join(directory, 'claude');
	const argsFile = join(directory, 'args');
	writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n${body}\n`);
	chmodSync(executable, 0o755);
	return { executable, argsFile };
}

describe('providers.install-claude-code', () => {
	it('opens an executable Terminal script that installs Claude Code, and only on macOS', async () => {
		const opened: string[] = [];
		const mac = boot({
			platform: 'darwin',
			openPath: async (path) => {
				opened.push(path);
				return '';
			},
		});

		expect(
			await mac.commands.invoke({ command: 'providers.install-claude-code', args: undefined }),
		).toEqual({ ok: true, value: null });
		expect(opened).toEqual([join(mac.appDataRoot, 'claude-setup', 'install.command')]);
		expect(readFileSync(opened[0] ?? '', 'utf8')).toBe(
			'#!/bin/sh\ncurl -fsSL https://claude.ai/install.sh | bash\n',
		);
		expect(statSync(opened[0] ?? '').mode & 0o777).toBe(0o700);

		const linux = boot({ platform: 'linux', openPath: () => Promise.reject(new Error('opened')) });
		expect(
			await linux.commands.invoke({ command: 'providers.install-claude-code', args: undefined }),
		).toEqual({
			ok: false,
			error:
				'Run `curl -fsSL https://claude.ai/install.sh | bash` in a terminal, then check again.',
		});
	});
});

describe('providers.sign-in-to-claude', () => {
	it('runs claude auth login with the account to switch to and reports the sign-in', async () => {
		const claude = fakeClaude('echo "Login successful."');
		const { commands } = boot({
			executable: () => claude.executable,
			environment: shellEnvironment,
		});

		const signIn = (args: unknown) =>
			commands.invoke({ command: 'providers.sign-in-to-claude', args });

		expect(await signIn({ email: 'work@example.com' })).toEqual({ ok: true, value: 'signed-in' });
		expect(readFileSync(claude.argsFile, 'utf8')).toBe('auth\nlogin\n--email=work@example.com\n');
		expect(await signIn({})).toEqual({ ok: true, value: 'signed-in' });
		expect(readFileSync(claude.argsFile, 'utf8')).toBe('auth\nlogin\n');
		expect(await signIn({ email: '--console' })).toEqual({
			ok: false,
			error: 'invalid args: `email` must be an email address',
		});
	});

	it('surfaces why the login failed, without the browser hints', async () => {
		const claude = fakeClaude(
			[
				'echo "Opening browser to sign in…"',
				`echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize"`,
				'printf "Paste code here if prompted > "',
				'echo "OAuth login failed: the request timed out" >&2',
				'exit 1',
			].join('\n'),
		);
		const { commands } = boot({
			executable: () => claude.executable,
			environment: shellEnvironment,
		});

		expect(await commands.invoke({ command: 'providers.sign-in-to-claude', args: {} })).toEqual({
			ok: false,
			error: 'OAuth login failed: the request timed out',
		});
	});

	it('stops a waiting login when cancelled and reports it as cancelled', async () => {
		const claude = fakeClaude('sleep 30');
		const { commands } = boot({
			executable: () => claude.executable,
			environment: shellEnvironment,
		});

		const waiting = commands.invoke({ command: 'providers.sign-in-to-claude', args: {} });
		await expect.poll(() => existsSync(claude.argsFile)).toBe(true);
		await commands.invoke({ command: 'providers.cancel-claude-sign-in', args: undefined });

		expect(await waiting).toEqual({ ok: true, value: 'cancelled' });
	});

	it('asks for an install when Claude Code is not on this Mac', async () => {
		const { commands } = boot({ executable: () => null, environment: shellEnvironment });

		expect(await commands.invoke({ command: 'providers.sign-in-to-claude', args: {} })).toEqual({
			ok: false,
			error: 'Claude Code is not installed. Install it, then sign in.',
		});
	});
});
