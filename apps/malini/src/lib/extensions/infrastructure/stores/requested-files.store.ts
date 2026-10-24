import type { FileOpenRequestedPayload } from '$contract/events';

import {
	readRequestedFiles,
	withoutRequestedFile,
	withRequestedFile,
} from '../../domain/requested-file';

const REQUESTED_FILES_KEY = 'malini.requested-files-v1';

class RequestedFilesStore {
	add(request: FileOpenRequestedPayload): void {
		write(withRequestedFile(read(), request));
	}

	readyIn(ready: (workstreamId: string) => boolean): FileOpenRequestedPayload[] {
		return read().filter(({ workstreamId }) => ready(workstreamId));
	}

	remove(request: FileOpenRequestedPayload): void {
		write(withoutRequestedFile(read(), request));
	}
}

function read(): FileOpenRequestedPayload[] {
	try {
		const stored = globalThis.localStorage?.getItem(REQUESTED_FILES_KEY) ?? null;
		return stored === null ? [] : readRequestedFiles(JSON.parse(stored));
	} catch {
		return [];
	}
}

function write(requests: readonly FileOpenRequestedPayload[]): void {
	try {
		if (requests.length === 0) globalThis.localStorage?.removeItem(REQUESTED_FILES_KEY);
		else globalThis.localStorage?.setItem(REQUESTED_FILES_KEY, JSON.stringify(requests));
	} catch {}
}

export const requestedFilesStore = new RequestedFilesStore();
