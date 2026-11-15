import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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
	gitForWindowsNeeds,
	runWithTimeout,
	useGitForWindows,
	writeEnvironmentDiagnostics,
} from './environment';
import { gitHome } from './git-install';

const WINDOWS = process.platform === 'win32';
const tempDirs: string[] = [];
const searchPath = (...entries: string[]): string => entries.join(delimiter);

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
			{ raw: `PATH=${searchPath('.', 'node_modules/.bin', '~/bin', '/opt/homebrew/bin')}\0` },
			{ PATH: searchPath('relative/too', '/usr/bin') },
		);
		const entries = resolved.path.split(delimiter);
		for (const rejected of ['.', 'node_modules/.bin', '~/bin', 'relative/too']) {
			expect(entries).not.toContain(rejected);
		}
		expect(entries).toEqual(['/opt/homebrew/bin', '/usr/bin']);
	});

	it('puts the captured PATH first, appends the inherited one, and dedupes', () => {
		const resolved = resolveEnvironmentFrom(
			{ raw: `PATH=${searchPath('/home/u/.nvm/versions/node/v24/bin', '/usr/bin')}\0` },
			{ PATH: searchPath('/usr/bin', '/bin', '/usr/sbin', '/sbin') },
		);
		expect(resolved.path).toBe(
			searchPath('/home/u/.nvm/versions/node/v24/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'),
		);
		expect(resolved.source).toBe('login-shell');
		expect(resolved.degradation).toBeNull();
	});

	it('carries no hardcoded directories: a failed capture is the inherited PATH alone', () => {
		const resolved = resolveEnvironmentFrom(
			{ error: '`/bin/zsh -ilc env` did not finish within 5s' },
			{ PATH: searchPath('/usr/bin', '/bin', '/usr/sbin', '/sbin') },
		);
		expect(resolved.source).toBe('inherited');
		expect(resolved.degradation).toBe('`/bin/zsh -ilc env` did not finish within 5s');
		expect(resolved.path).toBe(searchPath('/usr/bin', '/bin', '/usr/sbin', '/sbin'));
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
			'RUSTUP_HOME=/home/u/.rustup\0AWS_SECRET_ACCESS_KEY=hunter2\0GITHUB_TOKEN=ghp_live\0WIDGETS_API_KEY=sk-live\0';
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

	it('honors DO_NOT_TRACK from the login shell or the inherited environment', () => {
		const doNotTrack = (raw: string, inherited: Record<string, string> = {}): boolean =>
			resolveEnvironmentFrom({ raw: `PATH=/usr/bin\0${raw}` }, inherited).doNotTrack;
		expect(doNotTrack('DO_NOT_TRACK=1\0')).toBe(true);
		expect(doNotTrack('DO_NOT_TRACK=true\0')).toBe(true);
		expect(doNotTrack('', { DO_NOT_TRACK: '1' })).toBe(true);
		expect(doNotTrack('DO_NOT_TRACK=0\0')).toBe(false);
		expect(doNotTrack('')).toBe(false);
		expect(resolveEnvironmentFrom({ error: 'no shell' }, { DO_NOT_TRACK: '1' }).doNotTrack).toBe(
			true,
		);
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
		const executable = join(second, WINDOWS ? 'node.cmd' : 'node');
		writeFileSync(executable, '#!/bin/sh\n');
		chmodSync(executable, 0o755);
		writeFileSync(join(first, 'node'), 'not executable');
		const environment = resolveEnvironmentFrom({ raw: `PATH=${searchPath(first, second)}\0` }, {});

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

const NODE_EXITS_3 =
	"process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 3";
const NODE_LEAVES_GRANDCHILD =
	"require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)'], { stdio: 'inherit', detached: true }).unref()";

describe('runWithTimeout', () => {
	it('returns the exit code and both streams, chunk callbacks included', async () => {
		const seen: string[] = [];
		const result = await runWithTimeout(process.execPath, ['-e', NODE_EXITS_3], {
			timeoutMs: 5_000,
			onStdout: (text) => seen.push(`stdout:${text}`),
			onStderr: (text) => seen.push(`stderr:${text}`),
		});
		expect(result).toEqual({ exitCode: 3, timedOut: false, stdout: 'out', stderr: 'err' });
		expect(seen.sort()).toEqual(['stderr:err', 'stdout:out']);
	});

	it('kills a child that never exits', async () => {
		const started = Date.now();
		const result = await runWithTimeout(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
			timeoutMs: 200,
		});
		expect(result.exitCode).toBeNull();
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('returns when a backgrounded grandchild holds the pipe', async () => {
		const started = Date.now();
		const result = await runWithTimeout(
			process.execPath,
			['-e', `${NODE_LEAVES_GRANDCHILD}; setTimeout(() => {}, 20_000)`],
			{ timeoutMs: 300 },
		);
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(3_000);
	});

	it('returns when a grandchild holds the pipe after the child exited normally', async () => {
		const started = Date.now();
		const result = await runWithTimeout(
			process.execPath,
			['-e', `console.log('first'); ${NODE_LEAVES_GRANDCHILD}`],
			{ timeoutMs: 5_000 },
		);
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
	it.runIf(WINDOWS)('reads no login shell on Windows and keeps the PATH the app got', async () => {
		expect(await captureLoginShellEnvironment()).toEqual({
			error:
				'Windows starts apps with the environment of the user, so there is no login shell to read',
		});
		const resolved = await resolveEnvironment();
		expect(resolved.source).toBe('inherited');
		expect(resolveToolPath('cmd', resolved)).not.toBeNull();
	});

	it.skipIf(WINDOWS)('captures PATH from a controlled shell', async () => {
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

	it.skipIf(WINDOWS)('reports a shell that exits non-zero, times out, or is missing', async () => {
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

	it.skipIf(WINDOWS)(
		'never throws for the real login shell and always yields a usable PATH',
		async () => {
			const resolved = await resolveEnvironment();
			expect(resolved.path).toContain('/usr/bin');
			expect(resolveToolPath('sh', resolved)).not.toBeNull();
			expect(await resolveEnvironment()).toBe(resolved);
		},
	);
});

describe('preferredShell', () => {
	it.runIf(WINDOWS)('takes the Git Bash Claude Code is pointed at, else the one beside git', () => {
		const bash = join(tempDir(), 'bash.exe');
		writeFileSync(bash, '');
		expect(preferredShell({ CLAUDE_CODE_GIT_BASH_PATH: bash })).toBe(bash);
		expect(preferredShell({})).toMatch(/\\bin\\bash\.exe$/u);
	});

	it.skipIf(WINDOWS)(
		'takes an absolute existing $SHELL, else bash on Linux or zsh on macOS, else /bin/sh',
		() => {
			const shell = process.platform === 'linux' ? '/bin/bash' : '/bin/zsh';
			const fallback = existsSync(shell) ? shell : '/bin/sh';
			expect(preferredShell({ SHELL: '/bin/sh' })).toBe('/bin/sh');
			expect(preferredShell({ SHELL: 'zsh' })).toBe(fallback);
			expect(preferredShell({ SHELL: '/does/not/exist' })).toBe(fallback);
			expect(preferredShell({})).toBe(fallback);
		},
	);
});

describe('useGitForWindows', () => {
	function gitForWindows(root: string): string {
		mkdirSync(join(root, 'cmd'), { recursive: true });
		mkdirSync(join(root, 'bin'), { recursive: true });
		for (const name of ['git', 'git.exe']) {
			writeFileSync(join(root, 'cmd', name), '');
			chmodSync(join(root, 'cmd', name), 0o755);
		}
		writeFileSync(join(root, 'bin', 'bash.exe'), '');
		return join(root, 'bin', 'bash.exe');
	}

	it('keeps the git on PATH and points Claude Code at the Git Bash beside it', () => {
		const system = join(tempDir(), 'Git');
		const bash = gitForWindows(system);
		const vendor = tempDir();
		gitForWindows(gitHome(vendor));
		const env = { PATH: searchPath(tempDir(), join(system, 'cmd')) };
		const path = env.PATH;

		useGitForWindows(vendor, env);

		expect(env).toEqual({ PATH: path, CLAUDE_CODE_GIT_BASH_PATH: bash });
	});

	it('adds a Git for Windows that is off PATH before the one Malini installs', () => {
		const programs = tempDir();
		const bash = gitForWindows(join(programs, 'Git'));
		const vendor = tempDir();
		gitForWindows(gitHome(vendor));
		const empty = tempDir();
		const env = { PATH: empty, ProgramFiles: programs };

		useGitForWindows(vendor, env);

		expect(env).toEqual({
			PATH: searchPath(empty, join(programs, 'Git', 'cmd')),
			ProgramFiles: programs,
			CLAUDE_CODE_GIT_BASH_PATH: bash,
		});
	});

	it('adds the Git Malini installs, then an older one it installed, when no other Git exists', () => {
		const vendor = tempDir();
		const older = join(vendor, '2.40.0');
		const olderBash = gitForWindows(older);
		const empty = tempDir();
		const env: Record<string, string> = { PATH: empty };

		useGitForWindows(vendor, env);
		expect(env).toEqual({
			PATH: searchPath(empty, join(gitHome(vendor), 'cmd'), join(older, 'cmd')),
			CLAUDE_CODE_GIT_BASH_PATH: olderBash,
		});

		rmSync(older, { recursive: true });
		const fresh = { PATH: empty };
		useGitForWindows(vendor, fresh);
		expect(fresh).toEqual({
			PATH: searchPath(empty, join(gitHome(vendor), 'cmd')),
			CLAUDE_CODE_GIT_BASH_PATH: join(gitHome(vendor), 'bin', 'bash.exe'),
		});
	});

	it('asks for the pinned Git when git or Git Bash is missing, or only an older one it installed is in use', () => {
		const vendor = tempDir();
		const older = join(vendor, '2.40.0');
		gitForWindows(older);
		const system = join(tempDir(), 'Git');
		gitForWindows(system);
		const empty = tempDir();
		const withOlder = { PATH: empty };
		useGitForWindows(vendor, withOlder);

		expect(gitForWindowsNeeds(vendor, { PATH: empty })).toBe('install');
		expect(gitForWindowsNeeds(vendor, withOlder)).toBe('upgrade');
		expect(gitForWindowsNeeds(vendor, { PATH: join(system, 'cmd') })).toBe('nothing');
		gitForWindows(gitHome(vendor));
		expect(gitForWindowsNeeds(vendor, withOlder)).toBe('nothing');
	});

	it('keeps a Git Bash the user set that exists, and replaces one that does not', () => {
		const vendor = tempDir();
		const chosen = join(tempDir(), 'bash.exe');
		writeFileSync(chosen, '');
		const kept = { PATH: tempDir(), CLAUDE_CODE_GIT_BASH_PATH: chosen };
		const replaced = { PATH: tempDir(), CLAUDE_CODE_GIT_BASH_PATH: join(vendor, 'gone.exe') };

		useGitForWindows(vendor, kept);
		useGitForWindows(vendor, replaced);

		expect(kept.CLAUDE_CODE_GIT_BASH_PATH).toBe(chosen);
		expect(replaced.CLAUDE_CODE_GIT_BASH_PATH).toBe(join(gitHome(vendor), 'bin', 'bash.exe'));
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
