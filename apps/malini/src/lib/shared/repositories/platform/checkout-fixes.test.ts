import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realGit, removeDir, tempDir } from '$main/git/fixtures.test-support';
import type { ProcessRunner } from '$main/process/runner';
import type { CheckoutCase } from './checkout-doctor';
import { fixCheckout, waitUntil } from './checkout-fixes';

let root: string;

function answering(code: number, stderr: string, calls: string[][]): ProcessRunner {
	return {
		spawn(file, args, options) {
			calls.push([file, ...args]);
			options?.onStderr?.(stderr);
			return { pid: null, exit: Promise.resolve({ kind: 'exited', code }) };
		},
		signalProcessGroup: () => undefined,
		processGroupIsAlive: () => false,
		processIsAlive: () => false,
	};
}

function patient(runner: ProcessRunner): CheckoutCase {
	return {
		checkout: join(root, 'workstreams', 'ws1'),
		checkoutsRoot: root,
		repository: join(root, 'base'),
		origin: null,
		branch: 'malini/ws1',
		snapshotRefs: [],
		baseStart: async () => 'main',
		reclone: () => Promise.reject(new Error('this checkout has no origin')),
		runner,
	};
}

beforeEach(async () => {
	root = await realpath(await tempDir('malini-checkout-fixes-'));
});

afterEach(async () => {
	vi.useRealTimers();
	await removeDir(root);
});

describe('fixCheckout', () => {
	it('trusts the checkout and its base repository once in the global git config', async () => {
		vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'gitconfig'));
		const c = patient(answering(0, '', []));
		await mkdir(c.checkout, { recursive: true });
		await mkdir(join(root, 'base'));
		await fixCheckout('dubious-ownership', c);
		await fixCheckout('dubious-ownership', c);
		const trusted = await realGit(root, ['config', '--global', '--get-all', 'safe.directory']);
		expect(trusted.trim().split('\n')).toEqual([c.checkout, c.repository]);
	});

	it('returns quietly when the password dialog for the Xcode license is canceled', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const calls: string[][] = [];
		const canceled = answering(1, '0:65: execution error: User canceled. (-128)\n', calls);
		await fixCheckout('xcode-license', patient(canceled));
		expect(calls).toEqual([
			['/usr/bin/osascript', '-e', expect.stringContaining('-license accept')],
		]);
		expect(logged).not.toHaveBeenCalled();
		await fixCheckout('xcode-license', patient(answering(1, 'execution error: (-60007)\n', [])));
		expect(logged).toHaveBeenCalledOnce();
	});
});

describe('waitUntil', () => {
	it('gives up at the deadline', async () => {
		vi.useFakeTimers();
		let checks = 0;
		const waiting = waitUntil(async () => {
			checks += 1;
			return false;
		}, 10_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await waiting).toBe(false);
		expect(checks).toBe(6);
	});

	it('stops as soon as the condition holds', async () => {
		vi.useFakeTimers();
		let checks = 0;
		const waiting = waitUntil(async () => {
			checks += 1;
			return checks === 3;
		}, 10_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await waiting).toBe(true);
		expect(checks).toBe(3);
	});
});
