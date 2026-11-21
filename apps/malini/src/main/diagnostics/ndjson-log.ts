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
import { MaliniError, SHARED_ERROR_VERDICTS, type ErrorVerdicts } from '../errors';
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

const DIAGNOSTICS_LOG_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	io: 'bug',
	'unsafe-path': 'bug',
} as const satisfies ErrorVerdicts;

type DiagnosticsLogErrorKind = keyof typeof DIAGNOSTICS_LOG_ERROR_VERDICTS;

export class DiagnosticsLogError extends MaliniError<DiagnosticsLogErrorKind> {
	constructor(kind: DiagnosticsLogErrorKind, message: string, cause?: unknown) {
		super('DiagnosticsLogError', DIAGNOSTICS_LOG_ERROR_VERDICTS, kind, message, {
			code: errnoCode(cause),
			cause,
		});
	}
}

export function appendNdjsonRecord(
	appDataRoot: string,
	stem: string,
	record: unknown,
	maxBytes = MAX_LOG_BYTES,
): NdjsonAppendReceipt {
	const encoded = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
	try {
		mkdirSync(appDataRoot, { recursive: true });
	} catch (error) {
		throw new DiagnosticsLogError(
			'io',
			`could not create app data root: ${describe(error)}`,
			error,
		);
	}
	const directory = diagnosticsDirectory(appDataRoot);
	ensurePrivateDirectory(directory);
	const path = currentLogPath(directory, stem);
	const rotated = rotateIfNeeded(directory, stem, encoded.byteLength, maxBytes);
	const logWasMissing = regularFileSize(path) === null;
	const descriptor = openForAppend(path);
	try {
		writeSync(descriptor, encoded);
	} catch (error) {
		throw new DiagnosticsLogError(
			'io',
			`could not append to the diagnostics log ${path}: ${describe(error)}`,
			error,
		);
	} finally {
		closeSync(descriptor);
	}
	if (logWasMissing || rotated) syncDirectory(directory);
	return { path, sizeBytes: encoded.byteLength, rotated };
}

export function regularFileSize(path: string): number | null {
	const metadata = lstatOrNull(path, `could not inspect diagnostics log ${path}`);
	if (metadata === null) return null;
	if (metadata.isSymbolicLink())
		throw new DiagnosticsLogError('unsafe-path', `refusing symlink diagnostics log: ${path}`);
	if (!metadata.isFile())
		throw new DiagnosticsLogError('unsafe-path', `diagnostics log is not a file: ${path}`);
	if (!UNIX) return metadata.size;
	let descriptor: number;
	try {
		descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	} catch (error) {
		throw new DiagnosticsLogError(
			'io',
			`could not securely inspect diagnostics log ${path}: ${describe(error)}`,
			error,
		);
	}
	try {
		const opened = fstatSync(descriptor);
		if (!opened.isFile())
			throw new DiagnosticsLogError('unsafe-path', `diagnostics log is not a file: ${path}`);
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
				throw new DiagnosticsLogError(
					'io',
					`could not create diagnostics directory ${path}: ${describe(error)}`,
					error,
				);
			}
		}
		metadata = lstatOrNull(path, `could not inspect diagnostics directory ${path}`);
		if (metadata === null) {
			throw new DiagnosticsLogError(
				'io',
				`could not inspect diagnostics directory ${path}: vanished`,
			);
		}
	}
	if (metadata.isSymbolicLink())
		throw new DiagnosticsLogError('unsafe-path', `refusing symlink diagnostics directory: ${path}`);
	if (!metadata.isDirectory())
		throw new DiagnosticsLogError('unsafe-path', `diagnostics path is not a directory: ${path}`);
	if (!UNIX) return;
	try {
		chmodSync(path, 0o700);
	} catch (error) {
		throw new DiagnosticsLogError(
			'io',
			`could not secure diagnostics directory ${path}: ${describe(error)}`,
			error,
		);
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
		throw new DiagnosticsLogError(
			'io',
			`could not open diagnostics log ${path}: ${describe(error)}`,
			error,
		);
	}
	try {
		if (!fstatSync(descriptor).isFile()) {
			throw new DiagnosticsLogError('unsafe-path', `opened diagnostics log is not a file: ${path}`);
		}
		if (UNIX) fchmodSync(descriptor, 0o600);
	} catch (error) {
		closeSync(descriptor);
		throw error;
	}
	return descriptor;
}

function rotateIfNeeded(
	directory: string,
	stem: string,
	incomingBytes: number,
	maxBytes: number,
): boolean {
	const current = currentLogPath(directory, stem);
	const currentBytes = regularFileSize(current) ?? 0;
	if (currentBytes + incomingBytes <= maxBytes) return false;
	for (let index = MAX_ROTATED_FILES; index >= 1; index -= 1) {
		const source = index === 1 ? current : rotatedLogPath(directory, stem, index - 1);
		const destination = rotatedLogPath(directory, stem, index);
		if (regularFileSize(destination) !== null) {
			try {
				rmSync(destination);
			} catch (error) {
				throw new DiagnosticsLogError(
					'io',
					`could not remove rotated log ${destination}: ${describe(error)}`,
					error,
				);
			}
		}
		if (regularFileSize(source) === null) continue;
		try {
			renameSync(source, destination);
		} catch (error) {
			throw new DiagnosticsLogError(
				'io',
				`could not rotate log ${source} to ${destination}: ${describe(error)}`,
				error,
			);
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
		throw new DiagnosticsLogError(
			'io',
			`could not sync diagnostics directory: ${describe(error)}`,
			error,
		);
	}
}

function lstatOrNull(path: string, context: string): Stats | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if (errnoCode(error) === 'ENOENT') return null;
		throw new DiagnosticsLogError('io', `${context}: ${describe(error)}`, error);
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
