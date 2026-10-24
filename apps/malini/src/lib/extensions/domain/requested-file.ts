import type { FileOpenRequestedPayload } from '$contract/events';

export function readRequestedFiles(value: unknown): FileOpenRequestedPayload[] {
	return Array.isArray(value) ? value.filter(isRequestedFile) : [];
}

export function withRequestedFile(
	requests: readonly FileOpenRequestedPayload[],
	request: FileOpenRequestedPayload,
): FileOpenRequestedPayload[] {
	return [...requests.filter((other) => !sameFile(other, request)), request];
}

export function withoutRequestedFile(
	requests: readonly FileOpenRequestedPayload[],
	request: FileOpenRequestedPayload,
): FileOpenRequestedPayload[] {
	return requests.filter((other) => !(sameFile(other, request) && other.line === request.line));
}

export function requestedFileKey({ workstreamId, path }: FileOpenRequestedPayload): string {
	return JSON.stringify([workstreamId, path]);
}

function sameFile(left: FileOpenRequestedPayload, right: FileOpenRequestedPayload): boolean {
	return left.workstreamId === right.workstreamId && left.path === right.path;
}

function isRequestedFile(value: unknown): value is FileOpenRequestedPayload {
	if (typeof value !== 'object' || value === null) return false;
	const workstreamId: unknown = Reflect.get(value, 'workstreamId');
	const path: unknown = Reflect.get(value, 'path');
	const line: unknown = Reflect.get(value, 'line');
	return (
		typeof workstreamId === 'string' &&
		workstreamId !== '' &&
		typeof path === 'string' &&
		path !== '' &&
		(line === null || (typeof line === 'number' && Number.isInteger(line) && line > 0))
	);
}
