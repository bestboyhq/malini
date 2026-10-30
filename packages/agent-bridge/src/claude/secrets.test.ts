import { execFile, spawn } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
	bridgeSecretsFolder,
	claudeShell,
	SessionSecrets,
	sessionSecretsFolder,
} from './secrets.js';

const ROOT = mkdtempSync(join(tmpdir(), 'malini-secrets-test-'));

afterAll(() => rm(ROOT, { recursive: true, force: true }));

interface Ran {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}

function run(secrets: SessionSecrets, command: string): Promise<Ran> {
	return new Promise((resolve) => {
		execFile(
			secrets.runScript,
			[command],
			{ env: { PATH: process.env['PATH'], CLAUDE_CODE_SHELL: '/bin/bash' } },
			(error, stdout, stderr) =>
				resolve({ status: typeof error?.code === 'number' ? error.code : 0, stdout, stderr }),
		);
	});
}

function session(): SessionSecrets {
	return new SessionSecrets(sessionSecretsFolder(ROOT));
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
			spawn(secrets.runScript, ['echo 1-$STRIPE_KEY; echo 2 >&2; echo 3; echo 4 >&2; exit 5'], {
				env: { PATH: process.env['PATH'], CLAUDE_CODE_SHELL: '/bin/bash' },
				stdio: ['ignore', file, file],
			}).on('exit', resolve),
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

	it('writes its files for the user alone, and removes them', async () => {
		const secrets = session();
		await secrets.set({ TOKEN: 'secret-token-value' });
		const folder = secrets.runScript.replace(/\/run$/u, '');

		expect(statSync(folder).mode & 0o777).toBe(0o700);
		expect(statSync(join(folder, 'secrets.sh')).mode & 0o777).toBe(0o600);
		expect(statSync(join(folder, 'masks')).mode & 0o777).toBe(0o600);

		await secrets.remove();
		expect(existsSync(folder)).toBe(false);
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

	it('removes its folder when Malini stops the bridge with SIGTERM', async () => {
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

describe('claudeShell', () => {
	it('takes the shell Claude Code would pick', () => {
		expect(claudeShell({ CLAUDE_CODE_SHELL: '/bin/bash', SHELL: '/bin/zsh' })).toBe('/bin/bash');
		expect(claudeShell({ SHELL: '/bin/bash' })).toBe('/bin/bash');
		expect(claudeShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/bin/zsh');
		expect(claudeShell({ CLAUDE_CODE_SHELL: '/nowhere/zsh' })).toBe('/bin/zsh');
	});
});
