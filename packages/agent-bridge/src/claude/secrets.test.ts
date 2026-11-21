import { execFile, execFileSync, spawn } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { canSandbox, sandboxPrefix } from '../sandbox.js';
import {
	bridgeSecretsFolder,
	claudeShell,
	SessionSecrets,
	sessionSecretsFolder,
} from './secrets.js';

const WINDOWS = process.platform === 'win32';
const ROOT = mkdtempSync(join(tmpdir(), 'malini-session-test-'));

afterAll(() => rm(ROOT, { recursive: true, force: true }));

interface Ran {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}

const GIT_BASH =
	process.env['CLAUDE_CODE_GIT_BASH_PATH'] ??
	join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');

function prefixed(runScript: string, command: string): [file: string, args: string[]] {
	return WINDOWS ? [GIT_BASH, [runScript, command]] : [runScript, [command]];
}

const ENVIRONMENT = { PATH: process.env['PATH'], HOME: ROOT, CLAUDE_CODE_SHELL: '/bin/bash' };

function run(
	secrets: SessionSecrets,
	command: string,
	{ cwd = ROOT, env = {} }: { cwd?: string; env?: Readonly<Record<string, string>> } = {},
): Promise<Ran> {
	return new Promise((resolve) => {
		execFile(
			...prefixed(secrets.runScript, command),
			{ cwd, env: { ...ENVIRONMENT, ...env } },
			(error, stdout, stderr) =>
				resolve({ status: typeof error?.code === 'number' ? error.code : 0, stdout, stderr }),
		);
	});
}

function session(rtk: string | null = null): SessionSecrets {
	return new SessionSecrets(sessionSecretsFolder(ROOT), rtk);
}

const BUNDLED_RTK = resolve(__dirname, '../../../../apps/malini/vendor/rtk/bin/rtk');

function claudeCommand(command: string): string {
	const quoted = command.replaceAll("'", `'"'"'`);
	return `{ \\builtin shopt -u extglob || \\builtin setopt NO_EXTENDED_GLOB; } >/dev/null 2>&1 || true && eval '${quoted}' < /dev/null && pwd -P >| ${join(ROOT, 'cwd')}`;
}

function fakeRtk(): string {
	const rtk = join(mkdtempSync(join(ROOT, 'fake-rtk-')), 'rtk');
	writeFileSync(
		rtk,
		[
			'#!/bin/sh',
			'if [ "$1" = rewrite ]; then',
			'	sleep "${FAKE_SLEEP:-0}"',
			'	printf "%s" "${FAKE_REWRITE-rtk $2}"',
			'	exit "${FAKE_CODE:-3}"',
			'fi',
			'printf "compact: %s\\n" "$*"',
		].join('\n'),
		{ mode: 0o755 },
	);
	return rtk;
}

function compacting(rtk: string): SessionSecrets {
	const secrets = session(rtk);
	secrets.compactOutput(true);
	return secrets;
}

function gitRepository(): { cwd: string; env: Record<string, string> } {
	const cwd = mkdtempSync(join(ROOT, 'repository-'));
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
	writeFileSync(join(cwd, 'notes.txt'), 'notes\n');
	return { cwd, env: { HOME: mkdtempSync(join(ROOT, 'home-')) } };
}

describe('SessionSecrets', () => {
	it('sets a saved secret in the command and masks it in both streams, keeping the exit code', async () => {
		const secrets = session();
		await secrets.set({ STRIPE_KEY: 'sk-live-1234567890' });

		const ran = await run(secrets, 'echo "out=$STRIPE_KEY"; echo "err=$STRIPE_KEY" >&2; exit 3');

		expect(ran).toEqual({ status: 3, stdout: 'out=[secret]\n', stderr: 'err=[secret]\n' });
	});

	it('keeps the order of the two streams when they go to the same file', async () => {
		const secrets = session();
		await secrets.set({ STRIPE_KEY: 'sk-live-1234567890' });
		const output = join(ROOT, 'merged.txt');
		const file = openSync(output, 'w');

		const status = await new Promise<number | null>((resolve) =>
			spawn(
				...prefixed(
					secrets.runScript,
					'echo 1-$STRIPE_KEY; echo 2 >&2; echo 3; echo 4 >&2; exit 5',
				),
				{ env: ENVIRONMENT, stdio: ['ignore', file, file] },
			).on('exit', resolve),
		);
		closeSync(file);

		expect(status).toBe(5);
		expect(readFileSync(output, 'utf8')).toBe('1-[secret]\n2\n3\n4\n');
	});

	it('masks each line of a multi-line value, and leaves values under eight characters', async () => {
		const secrets = session();
		await secrets.set({
			PRIVATE_KEY: '-----BEGIN KEY-----\nabcdefghijklmnop\n-----END KEY-----',
			PIN: '1234',
		});

		const ran = await run(secrets, 'printf "%s\\n" "$PRIVATE_KEY"; echo "pin=$PIN"');

		expect(ran.stdout).toBe('[secret]\n[secret]\n[secret]\npin=1234\n');
	});

	it('keeps a value with quotes, spaces and dollars whole', async () => {
		const secrets = session();
		await secrets.set({ SHORT: `a'b "c$` });

		expect((await run(secrets, 'printf "%s" "$SHORT"')).stdout).toBe(`a'b "c$`);
	});

	it('runs a command untouched while nothing is saved', async () => {
		const ran = await run(session(), 'printf "no newline"; exit 4');

		expect(ran).toEqual({ status: 4, stdout: 'no newline', stderr: '' });
	});

	it('keeps masking a value after it is replaced, so no window shows it', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'first-token-value' });
		await secrets.set({ TOKEN: 'second-token-value' });

		expect(secrets.maskText('first-token-value second-token-value')).toBe('[secret] [secret]');
		expect((await run(secrets, 'echo "$TOKEN"')).stdout).toBe('[secret]\n');
	});

	it('masks strings anywhere in a tool output and returns the output itself when none match', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'secret-token-value' });
		const clean = { file: { content: 'nothing here', lines: ['a', 'b'] } };

		expect(
			secrets.mask({ file: { content: 'x secret-token-value y', lines: ['secret-token-value'] } }),
		).toEqual({
			file: { content: 'x [secret] y', lines: ['[secret]'] },
		});
		expect(secrets.mask(clean)).toBe(clean);
	});

	it.skipIf(WINDOWS)('writes its files for the user alone', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'secret-token-value' });
		const folder = secrets.runScript.replace(/\/run$/u, '');

		expect(statSync(folder).mode & 0o777).toBe(0o700);
		expect(statSync(join(folder, 'secrets.sh')).mode & 0o777).toBe(0o600);
		expect(statSync(join(folder, 'masks')).mode & 0o777).toBe(0o600);
	});

	it('removes its files', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'secret-token-value' });
		const folder = secrets.runScript.replace(/\/run$/u, '');

		await secrets.remove();
		expect(existsSync(folder)).toBe(false);
	});
});

describe('SessionSecrets environment', () => {
	it('exports the environment Malini sets into every command, without masking it', async () => {
		const secrets = session();
		await secrets.setEnvironment({
			MALINI_WORKSTREAM_ID: 'workstream-one-id',
			MALINI_PORT_WEB: '40001',
		});
		await secrets.set({ TOKEN: 'secret-token-value' });

		const ran = await run(secrets, 'echo "$MALINI_WORKSTREAM_ID $MALINI_PORT_WEB $TOKEN"');

		expect(ran.stdout).toBe('workstream-one-id 40001 [secret]\n');
	});
});

describe.skipIf(WINDOWS)('SessionSecrets leftovers', () => {
	function runLeading(secrets: SessionSecrets, command: string): Promise<Ran & { pid: number }> {
		return new Promise((resolve) => {
			const child = spawn(secrets.runScript, [command], {
				env: { PATH: process.env['PATH'], CLAUDE_CODE_SHELL: '/bin/bash' },
				detached: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8').on('data', (text: string) => (stdout += text));
			child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text));
			child.on('close', (code) =>
				resolve({ status: code ?? -1, stdout, stderr, pid: Number(stdout.trim()) }),
			);
		});
	}

	function alive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	function stopAfterTest(pid: number): void {
		onTestFinished(() => {
			if (alive(pid)) process.kill(pid, 'SIGKILL');
		});
	}

	it('stops what a command left running in its group once it ends, keeping its exit code', async () => {
		const ran = await runLeading(
			session(),
			'nohup /bin/sleep 300 >/dev/null 2>&1 & disown; echo $!; exit 4',
		);
		stopAfterTest(ran.pid);

		expect(ran.status).toBe(4);
		expect(alive(ran.pid)).toBe(false);
	});

	it('kills a leftover that ignores SIGTERM after three seconds', async () => {
		const started = Date.now();
		const ran = await runLeading(
			session(),
			'(trap "" TERM; exec /bin/sleep 300) >/dev/null 2>&1 & echo $!',
		);
		stopAfterTest(ran.pid);

		expect(alive(ran.pid)).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(2_900);
	});

	it('stops leftovers when the command output is masked too', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'secret-token-value' });

		const ran = await runLeading(secrets, '/bin/sleep 300 >/dev/null 2>&1 & echo $!');
		stopAfterTest(ran.pid);

		expect(alive(ran.pid)).toBe(false);
	});

	it('never signals a group it does not lead', async () => {
		const ran = await run(session(), '/bin/sleep 300 >/dev/null 2>&1 & echo $!');
		const leftover = Number(ran.stdout.trim());
		stopAfterTest(leftover);

		expect(leftover).toBeGreaterThan(1);
		expect(alive(leftover)).toBe(true);
	});
});

describe('SessionSecrets compact output', () => {
	const quoted = claudeCommand(`printf '%s\\n' "it's"`);

	it.each([0, 3])('runs the rewrite rtk answers with exit %i, its quotes whole', async (code) => {
		const ran = await run(compacting(fakeRtk()), quoted, { env: { FAKE_CODE: String(code) } });

		expect(ran).toEqual({ status: 0, stdout: "compact: printf %s\\n it's\n", stderr: '' });
	});

	it.each([1, 2, 5])('runs the command as written when rtk answers with exit %i', async (code) => {
		const ran = await run(compacting(fakeRtk()), quoted, { env: { FAKE_CODE: String(code) } });

		expect(ran).toEqual({ status: 0, stdout: "it's\n", stderr: '' });
	});

	it('runs the command as written when rtk does not answer within two seconds', async () => {
		const started = Date.now();

		const ran = await run(compacting(fakeRtk()), claudeCommand('echo hi'), {
			env: { FAKE_SLEEP: '5' },
		});

		expect(ran).toEqual({ status: 0, stdout: 'hi\n', stderr: '' });
		expect(Date.now() - started).toBeLessThan(4000);
	});

	it('takes only a rewrite that puts rtk in front of commands, so cat stays cat', async () => {
		writeFileSync(join(ROOT, 'whole.txt'), 'whole file\n');

		const ran = await run(compacting(fakeRtk()), claudeCommand('cat whole.txt'), {
			env: { FAKE_REWRITE: 'rtk read whole.txt' },
		});

		expect(ran.stdout).toBe('whole file\n');
	});

	it('leaves a hook or MCP server command alone, since Claude Code does not wrap it', async () => {
		expect((await run(compacting(fakeRtk()), 'echo hook')).stdout).toBe('hook\n');
	});

	it('runs every command as written once the switch is off, or when rtk is missing', async () => {
		const off = compacting(fakeRtk());
		off.compactOutput(false);
		const missing = compacting(join(ROOT, 'nowhere', 'rtk'));

		expect((await run(off, claudeCommand('echo hi'))).stdout).toBe('hi\n');
		expect((await run(missing, claudeCommand('echo hi'))).stdout).toBe('hi\n');
	});

	it('keeps the exit code of a rewritten command and masks its secrets', async () => {
		const secrets = compacting(fakeRtk());
		await secrets.set({ TOKEN: 'secret-token-value' });

		const ran = await run(secrets, claudeCommand('echo "$TOKEN"; exit 4'));

		expect(ran).toEqual({ status: 4, stdout: 'compact: echo [secret]\n', stderr: '' });
	});
});

describe.runIf(existsSync(BUNDLED_RTK) || (process.env['CI'] !== undefined && !WINDOWS))(
	'SessionSecrets with the rtk that scripts/fetch-rtk.mjs puts in apps/malini/vendor',
	() => {
		it('shortens git status, and keeps the exit code of a git command that fails', async () => {
			const repository = gitRepository();

			const raw = await run(session(), claudeCommand('git status'), repository);
			const compact = await run(compacting(BUNDLED_RTK), claudeCommand('git status'), repository);
			const failed = await run(compacting(BUNDLED_RTK), claudeCommand('git log'), repository);

			expect(raw.stdout).toContain('Untracked files:');
			expect(compact).toMatchObject({ status: 0, stderr: '' });
			expect(compact.stdout).toContain('?? notes.txt');
			expect(compact.stdout.length).toBeLessThan(raw.stdout.length / 2);
			expect(failed.status).toBe(128);
		});
	},
);

describe.runIf(canSandbox())('SessionSecrets in a sandbox', () => {
	function confined(rtk: string | null = null): { secrets: SessionSecrets; read: string } {
		const hidden = mkdtempSync(join(ROOT, 'hidden-'));
		writeFileSync(join(hidden, 'token'), 'hidden-token');
		const secrets = session(rtk);
		secrets.confine(sandboxPrefix({ checkout: ROOT, hidden: [hidden], internet: false }));
		return { secrets, read: `cat '${join(hidden, 'token').replaceAll('\\', '/')}'` };
	}

	it('runs every command inside the sandbox, with its secrets', async () => {
		const { secrets, read } = confined();
		await secrets.set({ TOKEN: 'secret-token-value' });

		expect((await run(secrets, read)).status).not.toBe(0);
		expect((await run(secrets, 'echo "$TOKEN"')).stdout).toBe('[secret]\n');
	});

	it('runs a command outside the sandbox once for each pass it is given', async () => {
		const { secrets, read } = confined();
		const outside = secrets.passOutside(read);

		expect(await run(secrets, outside)).toMatchObject({ status: 0, stdout: 'hidden-token' });
		expect((await run(secrets, outside)).status).not.toBe(0);
		expect((await run(secrets, `: malini-outside-${'0'.repeat(32)}; ${read}`)).status).not.toBe(0);
	});

	it('runs a command once in a sandbox that also opens what the user allowed', async () => {
		const { secrets } = confined();
		const granted = mkdtempSync(join(homedir(), '.malini-grant-test-'));
		onTestFinished(() => rm(granted, { recursive: true, force: true }));
		const write = `touch ${join(granted, 'state')}`;
		const once = secrets.passInside(
			write,
			sandboxPrefix({
				checkout: ROOT,
				hidden: [],
				internet: false,
				grants: [{ kind: 'path', path: granted }],
			}),
		);

		expect((await run(secrets, write)).status).not.toBe(0);
		expect((await run(secrets, `: malini-inside-${'0'.repeat(32)}; ${write}`)).status).not.toBe(0);
		expect((await run(secrets, once)).status).toBe(0);
		expect((await run(secrets, once)).status).not.toBe(0);
	});

	it.runIf(existsSync(BUNDLED_RTK))(
		'shortens git status inside the sandbox, and still runs a pass outside it',
		async () => {
			const { secrets, read } = confined(BUNDLED_RTK);
			secrets.compactOutput(true);
			const repository = gitRepository();

			const compact = await run(secrets, claudeCommand('git status'), repository);
			const outside = await run(secrets, claudeCommand(secrets.passOutside(read)));

			expect(compact).toMatchObject({ status: 0, stderr: '' });
			expect(compact.stdout).toContain('?? notes.txt');
			expect(compact.stdout).not.toContain('Untracked files:');
			expect(outside).toMatchObject({ status: 0, stdout: 'hidden-token' });
		},
	);

	it('leaves commands alone once the sandbox is lifted', async () => {
		const { secrets, read } = confined();
		secrets.confine(null);

		expect(secrets.passOutside(read)).toBe(read);
		expect((await run(secrets, read)).stdout).toBe('hidden-token');
	});
});

describe('bridgeSecretsFolder', () => {
	it('removes the folder a dead bridge left and keeps a live one', () => {
		const parent = mkdtempSync(join(ROOT, 'tmp-'));
		const dead = join(parent, 'malini-secrets-999999-abc');
		const live = join(parent, `malini-secrets-${process.ppid}-def`);
		mkdirSync(dead);
		mkdirSync(live);

		const folder = bridgeSecretsFolder(parent);

		expect(existsSync(dead)).toBe(false);
		expect(existsSync(live)).toBe(true);
		expect(folder.startsWith(join(parent, `malini-secrets-${process.pid}-`))).toBe(true);
	});

	it.skipIf(WINDOWS)('removes its folder when Malini stops the bridge with SIGTERM', async () => {
		const parent = mkdtempSync(join(ROOT, 'stopped-'));
		const built = pathToFileURL(resolve(__dirname, '..', '..', 'dist', 'claude', 'secrets.js'));
		const bridge = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { bridgeSecretsFolder } from ${JSON.stringify(built.href)};
				console.log(bridgeSecretsFolder(${JSON.stringify(parent)}));
				setInterval(() => {}, 1000);`,
			],
			{ stdio: ['ignore', 'pipe', 'inherit'] },
		);
		const folder = await new Promise<string>((found) =>
			bridge.stdout.once('data', (chunk: Buffer) => found(chunk.toString().trim())),
		);
		expect(existsSync(folder)).toBe(true);

		const exited = new Promise<number | null>((done) => bridge.on('exit', done));
		bridge.kill('SIGTERM');

		expect(await exited).toBe(143);
		expect(existsSync(folder)).toBe(false);
	});
});

describe.skipIf(WINDOWS)('claudeShell', () => {
	it('takes the shell Claude Code would pick, and the one this computer has otherwise', () => {
		const own = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';

		expect(claudeShell({ CLAUDE_CODE_SHELL: '/bin/bash', SHELL: '/bin/zsh' })).toBe('/bin/bash');
		expect(claudeShell({ SHELL: '/bin/bash' })).toBe('/bin/bash');
		expect(claudeShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe(own);
		expect(claudeShell({ CLAUDE_CODE_SHELL: '/nowhere/zsh' })).toBe(own);
	});
});
