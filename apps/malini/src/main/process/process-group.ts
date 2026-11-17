import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { errorCode } from '$main/errors';

const WINDOWS = process.platform === 'win32';

export const OWN_PROCESS_GROUP = WINDOWS ? { windowsHide: true } : { detached: true };

export function killProcessGroup(
	pid: number,
	signal: NodeJS.Signals,
	describeFailure?: (error: unknown) => string,
): void {
	if (WINDOWS) {
		killProcessTree(pid);
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if (errorCode(error) === 'ESRCH') return;
		if (describeFailure) throw new Error(describeFailure(error));
		throw error;
	}
}

export function stopProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
	if (WINDOWS && child.pid !== undefined) killProcessTree(child.pid);
	else child.kill(signal);
}

export function processGroupIsAlive(pid: number): boolean {
	return WINDOWS ? processIsAlive(pid) : probe(-pid);
}

export function processIsAlive(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0 && probe(pid);
}

function killProcessTree(pid: number): void {
	const taskkill = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe');
	spawn(taskkill, ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once(
		'error',
		() => undefined,
	);
}

function probe(target: number): boolean {
	if (!Number.isInteger(target) || target === 0) return false;
	try {
		process.kill(target, 0);
		return true;
	} catch (error) {
		return errorCode(error) === 'EPERM';
	}
}
