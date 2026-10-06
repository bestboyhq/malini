import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { singletonLockHolderPid, waitForPreviousInstanceToExit } from './single-instance';

let userData = '';

afterEach(() => rmSync(userData, { recursive: true, force: true }));

it('reads the pid of the instance holding the lock from its host-pid symlink', () => {
	userData = mkdtempSync(join(tmpdir(), 'malini-single-instance-'));
	expect(singletonLockHolderPid(userData)).toBeNull();
	symlinkSync('MacBook-Pro.local-43713', join(userData, 'SingletonLock'));
	expect(singletonLockHolderPid(userData)).toBe(43713);
});

it('does not wait on itself', async () => {
	userData = mkdtempSync(join(tmpdir(), 'malini-single-instance-'));
	symlinkSync(`host-${process.pid}`, join(userData, 'SingletonLock'));
	const started = Date.now();
	await waitForPreviousInstanceToExit(userData);
	expect(Date.now() - started).toBeLessThan(1_000);
});
