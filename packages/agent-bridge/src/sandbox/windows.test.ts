import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { SessionSecrets, sessionSecretsFolder } from '../claude/secrets.js';
import { canSandbox, sandboxPrefix } from '../sandbox.js';
import { windows } from './windows.js';

const DENIAL = { tag: '', operation: 'file-write-create' };

describe('windows.denials', () => {
	it('reads the path each Git Bash, Node and Windows denial names', () => {
		expect(
			windows.denials?.(
				[
					"touch: cannot touch '/c/Users/me/outside/a': Permission denied",
					'bash: /d/work/b: Permission denied',
					"Access to the path 'C:\\Users\\me\\c' is denied.",
					"Error: EPERM: operation not permitted, open 'C:\\\\Users\\\\me\\\\d'",
				].join('\r\n'),
			),
		).toEqual([
			{ ...DENIAL, process: 'touch', target: 'C:\\Users\\me\\outside\\a' },
			{ ...DENIAL, process: 'bash', target: 'D:\\work\\b' },
			{ ...DENIAL, process: '', target: 'C:\\Users\\me\\c' },
			{ ...DENIAL, process: '', target: 'C:\\Users\\me\\d' },
		]);
	});

	it('names each path once and skips lines that deny nothing on a drive', () => {
		expect(
			windows.denials?.(
				[
					'bash: /c/Users/me/a: Permission denied',
					"rm: cannot remove 'C:\\USERS\\ME\\A': Permission denied",
					'bash: /tmp/b: Permission denied',
					'cat: /c/Users/me/c: No such file or directory',
				].join('\n'),
			),
		).toEqual([{ ...DENIAL, process: 'bash', target: 'C:\\Users\\me\\a' }]);
	});
});

interface Ran {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}

const GIT_BASH =
	process.env['CLAUDE_CODE_GIT_BASH_PATH'] ??
	join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');

describe.runIf(process.platform === 'win32' && canSandbox())(
	'a command in the Windows sandbox',
	{ timeout: 120_000 },
	() => {
		let root = '';
		const at = (...names: string[]): string => join(root, ...names);
		const quoted = (path: string): string => `'${path.replaceAll('\\', '/')}'`;

		beforeAll(() => {
			root = mkdtempSync(join(homedir(), '.malini-sandbox-test-'));
			for (const folder of ['checkout', 'outside', 'hidden']) mkdirSync(at(folder));
			writeFileSync(at('hidden', 'token'), 'hidden-token');
			execFileSync('git', ['init', '--quiet', at('checkout')]);
		});

		afterAll(() => rm(root, { recursive: true, force: true }));

		function confined(internet = false): SessionSecrets {
			const secrets = new SessionSecrets(sessionSecretsFolder(root));
			secrets.confine(
				sandboxPrefix({ checkout: at('checkout'), hidden: [at('hidden')], internet }),
			);
			return secrets;
		}

		function run(secrets: SessionSecrets, command: string): Promise<Ran> {
			return new Promise((resolve) => {
				execFile(
					GIT_BASH,
					[secrets.runScript, command],
					{ env: { ...process.env, CLAUDE_CODE_SHELL: '/bin/bash' } },
					(error, stdout, stderr) =>
						resolve({ status: typeof error?.code === 'number' ? error.code : 0, stdout, stderr }),
				);
			});
		}

		it('writes in the checkout and nowhere else', async () => {
			const secrets = confined();
			const inside = at('checkout', 'inside.txt');
			const outside = at('outside', 'outside.txt');

			expect(await run(secrets, `echo in > ${quoted(inside)}`)).toMatchObject({ status: 0 });
			expect((await run(secrets, `echo out > ${quoted(outside)}`)).status).not.toBe(0);
			expect(readFileSync(inside, 'utf8')).toBe('in\n');
			expect(existsSync(outside)).toBe(false);
		});

		it('cannot read a hidden folder', async () => {
			const ran = await run(confined(), `cat ${quoted(at('hidden', 'token'))}`);

			expect(ran.status).not.toBe(0);
			expect(ran.stdout).not.toContain('hidden-token');
		});

		it('cannot change the git hooks or config of its checkout', async () => {
			const config = at('checkout', '.git', 'config');
			const hook = at('checkout', '.git', 'hooks', 'pre-commit');
			const before = readFileSync(config, 'utf8');
			const secrets = confined();

			expect((await run(secrets, `echo '[core]' >> ${quoted(config)}`)).status).not.toBe(0);
			expect((await run(secrets, `echo exit 0 > ${quoted(hook)}`)).status).not.toBe(0);
			expect(readFileSync(config, 'utf8')).toBe(before);
			expect(existsSync(hook)).toBe(false);
		});

		it('reaches this PC but not the internet while the internet is off', async () => {
			const server = createServer((socket) => socket.end('local\n'));
			server.listen(0, '127.0.0.1');
			await once(server, 'listening');
			onTestFinished(() => void server.close());
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			const secrets = confined();

			expect(
				await run(secrets, `exec 3<>/dev/tcp/127.0.0.1/${String(port)} && cat <&3`),
			).toMatchObject({ status: 0, stdout: 'local\n' });
			expect(
				(await run(secrets, 'timeout 20 bash -c "exec 3<>/dev/tcp/1.1.1.1/80"')).status,
			).not.toBe(0);
		});

		it('reaches the internet through its proxy once the internet is on', async () => {
			const ran = await run(
				confined(true),
				"curl -sS -o /dev/null -w '%{http_code}' http://example.com/",
			);

			expect(ran).toMatchObject({ status: 0, stdout: '200' });
		});

		it('cannot stop a process of the user', async () => {
			const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
				stdio: 'ignore',
			});
			onTestFinished(() => void host.kill());

			const ran = await run(confined(), `MSYS_NO_PATHCONV=1 taskkill /F /PID ${String(host.pid)}`);

			expect(ran.status).not.toBe(0);
			expect(host.exitCode).toBeNull();
		});
	},
);
