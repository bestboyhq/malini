import {
	chmodSync,
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	renameSync,
	rmSync,
	writeSync,
	type Stats,
} from 'node:fs';
import {
	MAX_LOG_BYTES,
	MAX_ROTATED_FILES,
	currentLogPath,
	diagnosticsDirectory,
	rotatedLogPath,
} from './diagnostics-files';

export interface NdjsonAppendReceipt {
	readonly path: string;
	readonly sizeBytes: number;
	readonly rotated: boolean;
}

const UNIX = process.platform !== 'win32';

export function appendNdjsonRecord(
	appDataRoot: string,
	stem: string,
	record: unknown,
): NdjsonAppendReceipt {
	const encoded = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
	try {
		mkdirSync(appDataRoot, { recursive: true });
	} catch (error) {
		throw new Error(`could not create app data root: ${describe(error)}`);
	}
	const directory = diagnosticsDirectory(appDataRoot);
	ensurePrivateDirectory(directory);
	const path = currentLogPath(directory, stem);
	const rotated = rotateIfNeeded(directory, stem, encoded.byteLength);
	const logWasMissing = regularFileSize(path) === null;
	const descriptor = openForAppend(path);
	try {
		writeSync(descriptor, encoded);
	} catch (error) {
		throw new Error(`could not append to the diagnostics log ${path}: ${describe(error)}`);
	} finally {
		closeSync(descriptor);
	}
	if (logWasMissing || rotated) syncDirectory(directory);
	return { path, sizeBytes: encoded.byteLength, rotated };
}

export function regularFileSize(path: string): number | null {
	const metadata = lstatOrNull(path, `could not inspect diagnostics log ${path}`);
	if (metadata === null) return null;
	if (metadata.isSymbolicLink()) throw new Error(`refusing symlink diagnostics log: ${path}`);
	if (!metadata.isFile()) throw new Error(`diagnostics log is not a file: ${path}`);
	if (!UNIX) return metadata.size;
	let descriptor: number;
	try {
		descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	} catch (error) {
		throw new Error(`could not securely inspect diagnostics log ${path}: ${describe(error)}`);
	}
	try {
		const opened = fstatSync(descriptor);
		if (!opened.isFile()) throw new Error(`diagnostics log is not a file: ${path}`);
		fchmodSync(descriptor, 0o600);
		return opened.size;
	} finally {
		closeSync(descriptor);
	}
}

function ensurePrivateDirectory(path: string): void {
	let metadata = lstatOrNull(path, `could not inspect diagnostics directory ${path}`);
	if (metadata === null) {
		try {
			mkdirSync(path);
		} catch (error) {
			if (errnoCode(error) !== 'EEXIST') {
				throw new Error(`could not create diagnostics directory ${path}: ${describe(error)}`);
			}
		}
		metadata = lstatOrNull(path, `could not inspect diagnostics directory ${path}`);
		if (metadata === null) {
			throw new Error(`could not inspect diagnostics directory ${path}: vanished`);
		}
	}
	if (metadata.isSymbolicLink()) throw new Error(`refusing symlink diagnostics directory: ${path}`);
	if (!metadata.isDirectory()) throw new Error(`diagnostics path is not a directory: ${path}`);
	if (!UNIX) return;
	try {
		chmodSync(path, 0o700);
	} catch (error) {
		throw new Error(`could not secure diagnostics directory ${path}: ${describe(error)}`);
	}
}

function openForAppend(path: string): number {
	regularFileSize(path);
	let flags = fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT;
	if (UNIX) flags |= fsConstants.O_NOFOLLOW;
	let descriptor: number;
	try {
		descriptor = openSync(path, flags, 0o600);
	} catch (error) {
		throw new Error(`could not open diagnostics log ${path}: ${describe(error)}`);
	}
	try {
		if (!fstatSync(descriptor).isFile()) {
			throw new Error(`opened diagnostics log is not a file: ${path}`);
		}
		if (UNIX) fchmodSync(descriptor, 0o600);
	} catch (error) {
		closeSync(descriptor);
		throw error;
	}
	return descriptor;
}

function rotateIfNeeded(directory: string, stem: string, incomingBytes: number): boolean {
	const current = currentLogPath(directory, stem);
	const currentBytes = regularFileSize(current) ?? 0;
	if (currentBytes + incomingBytes <= MAX_LOG_BYTES) return false;
	for (let index = MAX_ROTATED_FILES; index >= 1; index -= 1) {
		const source = index === 1 ? current : rotatedLogPath(directory, stem, index - 1);
		const destination = rotatedLogPath(directory, stem, index);
		if (regularFileSize(destination) !== null) {
			try {
				rmSync(destination);
			} catch (error) {
				throw new Error(`could not remove rotated log ${destination}: ${describe(error)}`);
			}
		}
		if (regularFileSize(source) === null) continue;
		try {
			renameSync(source, destination);
		} catch (error) {
			throw new Error(`could not rotate log ${source} to ${destination}: ${describe(error)}`);
		}
	}
	return true;
}

function syncDirectory(path: string): void {
	if (!UNIX) return;
	try {
		const descriptor = openSync(path, 'r');
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
	} catch (error) {
		throw new Error(`could not sync diagnostics directory: ${describe(error)}`);
	}
}

function lstatOrNull(path: string, context: string): Stats | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if (errnoCode(error) === 'ENOENT') return null;
		throw new Error(`${context}: ${describe(error)}`);
	}
}

function errnoCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) return null;
	const code: unknown = Reflect.get(error, 'code');
	return typeof code === 'string' ? code : null;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
