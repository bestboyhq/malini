import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	buildSpawnEnvironment,
	captureLoginShellEnvironment,
	childEnvironment,
	parseEnvironmentRecords,
	preferredShell,
	resolveEnvironment,
	resolveEnvironmentFrom,
	resolveToolPath,
	runWithTimeout,
	writeEnvironmentDiagnostics,
} from './environment';

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'malini-env-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('parseEnvironmentRecords', () => {
	it('parses NUL-delimited env -0 output', () => {
		expect(parseEnvironmentRecords('PATH=/a:/b\0NVM_DIR=/home/u/.nvm\0EMPTY=\0')).toEqual([
			['PATH', '/a:/b'],
			['NVM_DIR', '/home/u/.nvm'],
			['EMPTY', ''],
		]);
	});

	it('parses newline-delimited printenv output', () => {
		expect(parseEnvironmentRecords('PATH=/a:/b\nPNPM_HOME=/home/u/Library/pnpm\n')).toEqual([
			['PATH', '/a:/b'],
			['PNPM_HOME', '/home/u/Library/pnpm'],
		]);
	});

	it('drops records that are not assignments', () => {
		expect(
			parseEnvironmentRecords(
				'starting zsh\nPATH=/a\nnot an assignment\n2BAD=x\nlooks=like=a=value',
			),
		).toEqual([
			['PATH', '/a'],
			['looks', 'like=a=value'],
		]);
	});

	it('does not let an rc file banner swallow the first record', () => {
		const raw =
			'Updating oh-my-zsh\nnote: fnm 1.38 is available\nPATH=/usr/local/bin:/usr/bin\0NVM_DIR=/home/u/.nvm\0';
		expect(parseEnvironmentRecords(raw)).toEqual([
			['PATH', '/usr/local/bin:/usr/bin'],
			['NVM_DIR', '/home/u/.nvm'],
		]);
	});

	it('does not let a banner containing an equals sign swallow the first record', () => {
		expect(
			parseEnvironmentRecords('warning: NODE_OPTIONS= is deprecated\nPATH=/usr/local/bin\0'),
		).toEqual([['PATH', '/usr/local/bin']]);
	});

	it('keeps the newlines of a NUL-framed multi-line value', () => {
		expect(parseEnvironmentRecords('PATH=/usr/bin\0LS_COLORS=di=1:\nln=2\0')).toEqual([
			['PATH', '/usr/bin'],
			['LS_COLORS', 'di=1:\nln=2'],
		]);
	});
});

describe('resolveEnvironmentFrom', () => {
	it('never lets a relative PATH entry reach a child', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: 'PATH=.:node_modules/.bin:~/bin:/opt/homebrew/bin\0' },
			{ PATH: 'relative/too:/usr/bin' },
		);
		const entries = resolved.path.split(':');
		for (const rejected of ['.', 'node_modules/.bin', '~/bin', 'relative/too']) {
			expect(entries).not.toContain(rejected);
		}
		expect(entries).toEqual(['/opt/homebrew/bin', '/usr/bin']);
	});

	it('puts the captured PATH first, appends the inherited one, and dedupes', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: 'PATH=/home/u/.nvm/versions/node/v24/bin:/usr/bin\0' },
			{ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
		);
		expect(resolved.path).toBe('/home/u/.nvm/versions/node/v24/bin:/usr/bin:/bin:/usr/sbin:/sbin');
		expect(resolved.source).toBe('login-shell');
		expect(resolved.degradation).toBeNull();
	});

	it('carries no hardcoded directories: a failed capture is the inherited PATH alone', () => {
		const resolved = resolveEnvironmentFrom(
			{ error: '`/bin/zsh -ilc env` did not finish within 5s' },
			{ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
		);
		expect(resolved.source).toBe('inherited');
		expect(resolved.degradation).toBe('`/bin/zsh -ilc env` did not finish within 5s');
		expect(resolved.path).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
		expect(resolved.path).not.toContain('.hermes');
		expect(resolved.path).not.toContain('/opt/homebrew');
	});

	it('treats a shell that printed no PATH as a failed capture', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: "zsh: can't change option: monitor\n" },
			{ PATH: '/usr/bin' },
		);
		expect(resolved.source).toBe('inherited');
		expect(resolved.degradation).toBe('the login shell answered without a PATH');
	});

	it('forwards only allowlisted toolchain variables', () => {
		const raw =
			'PATH=/usr/bin\0NVM_DIR=/home/u/.nvm\0PNPM_HOME=/home/u/Library/pnpm\0CARGO_HOME=/home/u/.cargo\0' +
			'RUSTUP_HOME=/home/u/.rustup\0AWS_SECRET_ACCESS_KEY=hunter2\0GITHUB_TOKEN=ghp_live\0OPENAI_API_KEY=sk-live\0';
		const resolved = resolveEnvironmentFrom(
			{ raw },
			{ PATH: '/usr/bin', STRIPE_SECRET_KEY: 'sk_live' },
		);
		expect(resolved.toolchainVariables.map(([name]) => name)).toEqual([
			'NVM_DIR',
			'PNPM_HOME',
			'CARGO_HOME',
			'RUSTUP_HOME',
		]);
		const serialized = JSON.stringify(childEnvironment(resolved));
		for (const secret of ['hunter2', 'ghp_live', 'sk-live', 'sk_live']) {
			expect(serialized).not.toContain(secret);
		}
	});

	it('falls back to the inherited value for an allowlisted variable and drops empty ones', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: 'PATH=/usr/bin\0' },
			{ PATH: '/usr/bin', VOLTA_HOME: '/home/u/.volta', SDKMAN_DIR: '' },
		);
		expect(resolved.toolchainVariables).toEqual([['VOLTA_HOME', '/home/u/.volta']]);
	});

	it('leads the child environment with PATH', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: 'PATH=/usr/bin\0MISE_DATA_DIR=/home/u/.mise\0' },
			{},
		);
		const env = childEnvironment(resolved);
		expect(Object.keys(env)[0]).toBe('PATH');
		expect(env).toEqual({ PATH: '/usr/bin', MISE_DATA_DIR: '/home/u/.mise' });
	});
});

describe('resolveToolPath', () => {
	it('finds the first executable on the resolved PATH and nothing else', () => {
		const first = tempDir();
		const second = tempDir();
		const executable = join(second, 'node');
		writeFileSync(executable, '#!/bin/sh\n');
		chmodSync(executable, 0o755);
		writeFileSync(join(first, 'node'), 'not executable');
		const environment = resolveEnvironmentFrom({ raw: `PATH=${first}:${second}\0` }, {});

		expect(resolveToolPath('node', environment)).toBe(executable);
		expect(resolveToolPath('definitely-not-installed', environment)).toBeNull();
		expect(resolveToolPath('sub/node', environment)).toBeNull();
		expect(resolveToolPath(executable, environment)).toBe(executable);
	});
});

describe('buildSpawnEnvironment', () => {
	it('starts from the process environment, applies overrides, and removes undefined ones', () => {
		const env = buildSpawnEnvironment({ MALINI_TEST_ADDED: 'yes', HOME: undefined });
		expect(env['MALINI_TEST_ADDED']).toBe('yes');
		expect(env).not.toHaveProperty('HOME');
		expect(env['PATH']).toBeTruthy();
	});
});

describe('runWithTimeout', () => {
	it('returns the exit code and both streams, chunk callbacks included', async () => {
		const seen: string[] = [];
		const result = await runWithTimeout('/bin/sh', ['-c', 'printf out; printf err >&2; exit 3'], {
			timeoutMs: 5_000,
			onStdout: (text) => seen.push(`stdout:${text}`),
			onStderr: (text) => seen.push(`stderr:${text}`),
		});
		expect(result).toEqual({ exitCode: 3, timedOut: false, stdout: 'out', stderr: 'err' });
		expect(seen.sort()).toEqual(['stderr:err', 'stdout:out']);
	});

	it('kills a child that never exits', async () => {
		const started = Date.now();
		const result = await runWithTimeout('/bin/sh', ['-c', 'sleep 30'], { timeoutMs: 200 });
		expect(result.exitCode).toBeNull();
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('returns when a backgrounded grandchild holds the pipe', async () => {
		const started = Date.now();
		const result = await runWithTimeout('/bin/sh', ['-c', '(sleep 60 &); sleep 60'], {
			timeoutMs: 300,
		});
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(3_000);
	});

	it('returns when a grandchild holds the pipe after the child exited normally', async () => {
		const started = Date.now();
		const result = await runWithTimeout('/bin/sh', ['-c', 'echo first; (sleep 60 &); exit 0'], {
			timeoutMs: 5_000,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('first\n');
		expect(Date.now() - started).toBeLessThan(3_000);
	});

	it('rejects when the binary cannot be spawned', async () => {
		await expect(
			runWithTimeout('/definitely/not/a/binary', [], { timeoutMs: 1_000 }),
		).rejects.toMatchObject({ code: 'ENOENT' });
	});
});

describe('captureLoginShellEnvironment', () => {
	it('captures PATH from a controlled shell', async () => {
		const dir = tempDir();
		const shell = join(dir, 'shell.sh');
		writeFileSync(
			shell,
			'#!/bin/sh\necho "banner before env"\nPATH=/captured/bin:/usr/bin exec /usr/bin/env -0\n',
		);
		chmodSync(shell, 0o755);
		const captured = await captureLoginShellEnvironment({ shell, timeoutMs: 5_000 });
		expect('raw' in captured).toBe(true);
		const resolved = resolveEnvironmentFrom(captured, { PATH: '/inherited/bin' });
		expect(resolved.path).toBe('/captured/bin:/usr/bin:/inherited/bin');
		expect(resolved.source).toBe('login-shell');
	});

	it('reports a shell that exits non-zero, times out, or is missing', async () => {
		const dir = tempDir();
		const failing = join(dir, 'failing.sh');
		writeFileSync(failing, '#!/bin/sh\nexit 7\n');
		chmodSync(failing, 0o755);
		expect(await captureLoginShellEnvironment({ shell: failing })).toEqual({
			error: `\`${failing} -ilc env\` exited 7`,
		});

		const hanging = join(dir, 'hanging.sh');
		writeFileSync(hanging, '#!/bin/sh\nsleep 30\n');
		chmodSync(hanging, 0o755);
		expect(await captureLoginShellEnvironment({ shell: hanging, timeoutMs: 200 })).toEqual({
			error: `\`${hanging} -ilc env\` did not finish within 0.2s`,
		});

		expect(await captureLoginShellEnvironment({ shell: null })).toEqual({
			error: 'no usable login shell (`$SHELL` unset and /bin/zsh missing)',
		});
		const missing = join(dir, 'missing.sh');
		const result = await captureLoginShellEnvironment({ shell: missing });
		expect(
			'error' in result && result.error.startsWith(`could not run \`${missing} -ilc env\``),
		).toBe(true);
	});

	it('never throws for the real login shell and always yields a usable PATH', async () => {
		const resolved = await resolveEnvironment();
		expect(resolved.path).toContain('/usr/bin');
		expect(resolveToolPath('sh', resolved)).not.toBeNull();
		expect(await resolveEnvironment()).toBe(resolved);
	});
});

describe('preferredShell', () => {
	it('takes an absolute existing $SHELL, else /bin/zsh, else /bin/sh', () => {
		const fallback = existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
		expect(preferredShell({ SHELL: '/bin/sh' })).toBe('/bin/sh');
		expect(preferredShell({ SHELL: 'zsh' })).toBe(fallback);
		expect(preferredShell({ SHELL: '/does/not/exist' })).toBe(fallback);
		expect(preferredShell({})).toBe(fallback);
	});
});

describe('writeEnvironmentDiagnostics', () => {
	it('leaves a record a user can be asked for, names only', () => {
		const root = tempDir();
		const resolved = resolveEnvironmentFrom(
			{ error: '`/bin/zsh -ilc env` exited 1' },
			{ PATH: '/usr/bin', VOLTA_HOME: '/home/u/.volta' },
		);
		const path = writeEnvironmentDiagnostics(root, resolved);
		expect(path).toBe(join(root, 'diagnostics', 'environment.json'));
		const written = readFileSync(path, 'utf8');
		expect(JSON.parse(written)).toEqual({
			schemaVersion: 1,
			source: 'inherited',
			degradation: '`/bin/zsh -ilc env` exited 1',
			path: '/usr/bin',
			toolchainVariables: ['VOLTA_HOME'],
		});
		expect(written).not.toContain('/home/u/.volta');
	});
});
