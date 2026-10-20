import {
	TOAST_LEVELS,
	toastTextIsKept,
	type DiagnosticLevel,
	type RendererToastPayload,
	type ToastDiagnosticLevel,
} from '$contract/diagnostics';
import {
	RENDERER_ERROR_SOURCES,
	type RendererErrorDetail,
	type RendererErrorPayload,
	type RendererErrorReceipt,
	type RendererErrorSource,
} from '$contract/system';
import { RENDERER_LOG_STEM } from '$main/diagnostics/diagnostics-files';
import { appendNdjsonRecord } from '$main/diagnostics/ndjson-log';
import { sanitizeDiagnosticText, sanitizeRoute } from '$main/diagnostics/redaction';

export const SCHEMA_VERSION = 1;
export const MAX_PENDING_WRITES = 8;
const MAX_NAME_CHARS = 80;
const MAX_MESSAGE_CHARS = 512;
const MAX_STACK_CHARS = 8_192;

const RENDERER_ERROR_SOURCE_SET: ReadonlySet<string> = new Set(RENDERER_ERROR_SOURCES);
const TOAST_LEVEL_SET: ReadonlySet<string> = new Set(TOAST_LEVELS);

function isRendererErrorSource(value: unknown): value is RendererErrorSource {
	return typeof value === 'string' && RENDERER_ERROR_SOURCE_SET.has(value);
}

function isToastLevel(value: unknown): value is ToastDiagnosticLevel {
	return typeof value === 'string' && TOAST_LEVEL_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export interface RendererRuntimeIdentity {
	productName: string;
	bundleIdentifier: string;
	version: string;
	pid: number;
}

interface DurableRendererErrorRecord {
	schemaVersion: number;
	occurredAt: string;
	persistedAt: string;
	level: DiagnosticLevel;
	source: RendererErrorSource;
	route: string;
	error: RendererErrorDetail;
	runtime: RendererRuntimeIdentity;
}

interface DurableToastRecord {
	schemaVersion: number;
	occurredAt: string;
	persistedAt: string;
	level: DiagnosticLevel;
	source: 'toast';
	toastLevel: ToastDiagnosticLevel;
	route: string;
	workstreamId: string | null;
	message: string;
	runtime: RendererRuntimeIdentity;
}

export const PERSISTENCE_BUSY_ERROR = `renderer error persistence is busy (${MAX_PENDING_WRITES} writes pending)`;

export class RendererErrorLog {
	#pendingWrites = 0;
	readonly #appDataRoot: string;
	readonly #runtime: RendererRuntimeIdentity;

	constructor(appDataRoot: string, runtime: RendererRuntimeIdentity) {
		this.#appDataRoot = appDataRoot;
		this.#runtime = runtime;
	}

	get pending(): number {
		return this.#pendingWrites;
	}

	claimPermit(): () => void {
		if (this.#pendingWrites >= MAX_PENDING_WRITES) {
			throw new Error(PERSISTENCE_BUSY_ERROR);
		}
		this.#pendingWrites += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#pendingWrites -= 1;
		};
	}

	async persist(payload: unknown): Promise<RendererErrorReceipt> {
		const release = this.claimPermit();
		try {
			return await this.append(payload, utcNow());
		} finally {
			release();
		}
	}

	async persistToast(payload: unknown): Promise<RendererErrorReceipt> {
		const release = this.claimPermit();
		try {
			return await this.appendToast(payload, utcNow());
		} finally {
			release();
		}
	}

	async append(payload: unknown, persistedAt: string = utcNow()): Promise<RendererErrorReceipt> {
		const normalized = normalizePayload(payload);
		const persisted = normalizeUtcTimestamp(persistedAt, 'persistedAt');
		const record: DurableRendererErrorRecord = {
			schemaVersion: SCHEMA_VERSION,
			occurredAt: normalized.occurredAt,
			persistedAt: persisted,
			level: 'error',
			source: normalized.source,
			route: normalized.route,
			error: normalized.error,
			runtime: this.#runtime,
		};
		return this.#write(record, persisted);
	}

	async appendToast(
		payload: unknown,
		persistedAt: string = utcNow(),
	): Promise<RendererErrorReceipt> {
		const toast = normalizeToastPayload(payload);
		const persisted = normalizeUtcTimestamp(persistedAt, 'persistedAt');
		const record: DurableToastRecord = {
			schemaVersion: SCHEMA_VERSION,
			occurredAt: toast.occurredAt,
			persistedAt: persisted,
			level: diagnosticLevelOfToast(toast.level),
			source: 'toast',
			toastLevel: toast.level,
			route: toast.route,
			workstreamId: toast.workstreamId,
			message: toast.text ?? `${toast.level} toast, text not kept`,
			runtime: this.#runtime,
		};
		return this.#write(record, persisted);
	}

	#write(
		record: DurableRendererErrorRecord | DurableToastRecord,
		persistedAt: string,
	): RendererErrorReceipt {
		const receipt = appendNdjsonRecord(this.#appDataRoot, RENDERER_LOG_STEM, record);
		return {
			path: receipt.path,
			persistedAt,
			sizeBytes: receipt.sizeBytes,
			rotated: receipt.rotated,
		};
	}
}

export function diagnosticLevelOfToast(level: ToastDiagnosticLevel): DiagnosticLevel {
	if (level === 'error') return 'error';
	if (level === 'warning') return 'warn';
	return 'info';
}

export function normalizeToastPayload(value: unknown): RendererToastPayload {
	const invalid = (why: string): never => {
		throw new Error(`invalid toast payload: ${why}`);
	};
	if (!isRecord(value)) return invalid('expected an object');
	if (value.schemaVersion !== SCHEMA_VERSION) {
		return invalid(`unsupported schema version ${JSON.stringify(value.schemaVersion)}`);
	}
	if (typeof value.occurredAt !== 'string') return invalid('occurredAt must be a string');
	if (typeof value.route !== 'string') return invalid('route must be a string');
	if (!isToastLevel(value.level)) return invalid(`unknown level ${JSON.stringify(value.level)}`);
	if (value.text !== null && value.text !== undefined && typeof value.text !== 'string') {
		return invalid('text must be a string or null');
	}
	const workstreamId = value.workstreamId ?? null;
	if (workstreamId !== null && typeof workstreamId !== 'string') {
		return invalid('workstreamId must be a string or null');
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		occurredAt: normalizeUtcTimestamp(value.occurredAt, 'occurredAt'),
		route: sanitizeRoute(value.route),
		level: value.level,
		text:
			toastTextIsKept(value.level) && typeof value.text === 'string'
				? sanitizeDiagnosticText(value.text, MAX_MESSAGE_CHARS, false, '(empty toast)')
				: null,
		workstreamId:
			workstreamId === null
				? null
				: sanitizeDiagnosticText(workstreamId, MAX_NAME_CHARS, false, '') || null,
	};
}

export function normalizePayload(value: unknown): RendererErrorPayload {
	const payload = requirePayloadShape(value);
	if (payload.schemaVersion !== SCHEMA_VERSION) {
		throw new Error(`unsupported renderer error schema version: ${payload.schemaVersion}`);
	}
	const stack =
		payload.error.stack === null
			? null
			: orNull(sanitizeDiagnosticText(payload.error.stack, MAX_STACK_CHARS, true, ''));
	return {
		schemaVersion: SCHEMA_VERSION,
		occurredAt: normalizeUtcTimestamp(payload.occurredAt, 'occurredAt'),
		source: payload.source,
		route: sanitizeRoute(payload.route),
		error: {
			name: sanitizeDiagnosticText(payload.error.name, MAX_NAME_CHARS, false, 'Error'),
			message: sanitizeDiagnosticText(
				payload.error.message,
				MAX_MESSAGE_CHARS,
				false,
				'Renderer error',
			),
			stack,
		},
	};
}

interface IncomingPayload {
	schemaVersion: number;
	occurredAt: string;
	source: RendererErrorSource;
	route: string;
	error: { name: string; message: string; stack: string | null };
}

function requirePayloadShape(value: unknown): IncomingPayload {
	const invalid = (why: string): never => {
		throw new Error(`invalid renderer error payload: ${why}`);
	};
	if (!isRecord(value)) return invalid('expected an object');
	if (typeof value.schemaVersion !== 'number') return invalid('schemaVersion must be a number');
	if (typeof value.occurredAt !== 'string') return invalid('occurredAt must be a string');
	if (!isRendererErrorSource(value.source)) {
		return invalid(`unknown source ${JSON.stringify(value.source)}`);
	}
	if (typeof value.route !== 'string') return invalid('route must be a string');
	const error = value.error;
	if (!isRecord(error)) return invalid('error must be an object');
	if (typeof error.name !== 'string') return invalid('error.name must be a string');
	if (typeof error.message !== 'string') return invalid('error.message must be a string');
	if (error.stack !== undefined && error.stack !== null && typeof error.stack !== 'string') {
		return invalid('error.stack must be a string or null');
	}
	return {
		schemaVersion: value.schemaVersion,
		occurredAt: value.occurredAt,
		source: value.source,
		route: value.route,
		error: {
			name: error.name,
			message: error.message,
			stack: typeof error.stack === 'string' ? error.stack : null,
		},
	};
}

function orNull(value: string): string | null {
	return value.length === 0 ? null : value;
}

const RFC3339 =
	/^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function normalizeUtcTimestamp(value: string, field: string): string {
	const match = RFC3339.exec(value);
	if (!match) {
		throw new Error(`invalid renderer error ${field}: expected an RFC 3339 timestamp`);
	}
	const parsed = new Date(value.replace(' ', 'T'));
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`invalid renderer error ${field}: out of range`);
	}
	return parsed.toISOString();
}

export function utcNow(): string {
	return new Date().toISOString();
}
