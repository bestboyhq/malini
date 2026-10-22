import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GhError } from '$main/errors';
import { GitHubSignIn, parseDeviceCode } from './github-sign-in.service';

const FAKE_GH = `#!/bin/sh
echo "$@" > "$STATE/args"
if [ "$MODE" = "refuse" ]; then echo "error: GH_TOKEN is already set" 1>&2; exit 1; fi
if [ "$MODE" = "mute" ]; then echo "Welcome to a GitHub CLI that words things differently" 1>&2; sleep 5; exit 0; fi
echo "" 1>&2
echo "! First copy your one-time code: 45D6-E7E4" 1>&2
echo "Open this URL to continue in your web browser: https://github.com/login/device" 1>&2
while [ ! -f "$STATE/answer" ]; do sleep 0.02; done
if [ "$(cat "$STATE/answer")" = "deny" ]; then echo "error: authorization was denied" 1>&2; exit 1; fi
echo "✓ Logged in as octocat" 1>&2
`;

const signIns: GitHubSignIn[] = [];
const directories: string[] = [];

afterEach(async () => {
	for (const signIn of signIns.splice(0)) signIn.cancel();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

async function fakeGh(
	mode = 'device',
	codeTimeoutMs = 10_000,
): Promise<{ signIn: GitHubSignIn; state: string }> {
	const state = await mkdtemp(join(tmpdir(), 'malini-gh-sign-in-'));
	directories.push(state);
	const command = join(state, 'gh');
	await writeFile(command, FAKE_GH);
	await chmod(command, 0o755);
	const signIn = new GitHubSignIn({
		command,
		environment: () => ({ PATH: '/usr/bin:/bin', STATE: state, MODE: mode }),
		codeTimeoutMs,
	});
	signIns.push(signIn);
	return { signIn, state };
}

async function answer(state: string, verdict: 'approve' | 'deny'): Promise<void> {
	await writeFile(join(state, 'answer.partial'), verdict);
	await rename(join(state, 'answer.partial'), join(state, 'answer'));
}

describe('GitHubSignIn', () => {
	it('hands over the device code, then reports the sign-in once GitHub approves it', async () => {
		const { signIn, state } = await fakeGh();

		const code = await signIn.start();
		await answer(state, 'approve');

		expect(code).toEqual({
			userCode: '45D6-E7E4',
			verificationUri: 'https://github.com/login/device',
		});
		expect(await signIn.finish()).toBe('signed-in');
		expect((await readFile(join(state, 'args'), 'utf8')).trim()).toBe(
			'auth login --web --hostname github.com --git-protocol https --skip-ssh-key',
		);
	});

	it('reports a cancelled sign-in as cancelled, not as a failure', async () => {
		const { signIn } = await fakeGh();

		await signIn.start();
		signIn.cancel();

		expect(await signIn.finish()).toBe('cancelled');
	});

	it('fails with what gh said when GitHub denies the device', async () => {
		const { signIn, state } = await fakeGh();

		await signIn.start();
		await answer(state, 'deny');

		await expect(signIn.finish()).rejects.toThrow('authorization was denied');
	});

	it('fails the start with what gh said when gh stops before showing a code', async () => {
		const { signIn } = await fakeGh('refuse');

		await expect(signIn.start()).rejects.toThrow('GH_TOKEN is already set');
	});

	it('gives up and stops gh when it shows no code it can read', async () => {
		const { signIn } = await fakeGh('mute', 2_000);

		await expect(signIn.start()).rejects.toThrow(
			'GitHub CLI showed no sign-in code. Welcome to a GitHub CLI that words things differently',
		);
		expect(await signIn.finish()).toBe('cancelled');
	});

	it('fails the start as a missing GitHub CLI when gh cannot be found', async () => {
		const signIn = new GitHubSignIn({ command: '/nonexistent/gh' });
		signIns.push(signIn);

		await expect(signIn.start()).rejects.toBeInstanceOf(GhError);
	});
});

describe('parseDeviceCode', () => {
	it('waits until both the code and the URL have arrived', () => {
		expect(parseDeviceCode('! First copy your one-time code: 45D6-E7E4\n')).toBeNull();
	});

	it('reads the code whether gh copied it to the clipboard or could not', () => {
		const url = 'Open this URL to continue in your web browser: https://github.com/login/device\n';

		expect(parseDeviceCode(`! One-time code (82AE-23AA) copied to clipboard\n${url}`)).toEqual({
			userCode: '82AE-23AA',
			verificationUri: 'https://github.com/login/device',
		});
		expect(
			parseDeviceCode(
				`! Failed to copy one-time code to clipboard\n! First copy your one-time code: 1345-A8B9\n${url}`,
			)?.userCode,
		).toBe('1345-A8B9');
	});
});
