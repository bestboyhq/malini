import { readlinkSync } from 'node:fs';
import { join } from 'node:path';

const PREVIOUS_INSTANCE_EXIT_WAIT_MS = 60_000;
const EXIT_POLL_MS = 100;

export function singletonLockHolderPid(userDataPath: string): number | null {
	let target: string;
	try {
		target = readlinkSync(join(userDataPath, 'SingletonLock'));
	} catch {
		return null;
	}
	const pid = Number(/-(\d+)$/u.exec(target)?.[1]);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && 'code' in error && error.code === 'EPERM';
	}
}

// ponytail: reads Chromium's SingletonLock symlink (host-pid), so a dev restart waits for the old instance instead of losing the lock to it; upgrade if Electron ever exposes the lock holder
export async function waitForPreviousInstanceToExit(userDataPath: string): Promise<void> {
	const pid = singletonLockHolderPid(userDataPath);
	if (pid === null || pid === process.pid) return;
	const deadline = Date.now() + PREVIOUS_INSTANCE_EXIT_WAIT_MS;
	while (isRunning(pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, EXIT_POLL_MS));
	}
}
