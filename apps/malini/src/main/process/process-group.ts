import { errorCode } from '$main/errors';

export function killProcessGroup(
	pid: number,
	signal: NodeJS.Signals,
	describeFailure?: (error: unknown) => string,
): void {
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if (errorCode(error) === 'ESRCH') return;
		if (describeFailure) throw new Error(describeFailure(error));
		throw error;
	}
}

export function processGroupIsAlive(pid: number): boolean {
	return probe(-pid);
}

export function processIsAlive(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0 && probe(pid);
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
