import type { RendererErrorPayload, RendererErrorReceipt } from '$contract/system';
import { invoke } from '$shared/port/invoke';
import { currentDiagnosticRoute } from './diagnostic-route';

const MAX_NAME_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 512;
const MAX_STACK_LENGTH = 8_192;
const MAX_ROUTE_LENGTH = 1_024;
const MAX_QUERY_ENTRIES = 16;
const CAPTURE_RATE_WINDOW_MS = 10_000;
const MAX_CAPTURES_PER_WINDOW = 20;
const MAX_PERSISTENCE_QUEUE = 64;
const MAX_PERSISTENCE_ATTEMPTS = 3;
const DEFERRED_RESIZE_NOTIFICATIONS = /^ResizeObserver loop /u;

const installedTargets = new WeakMap<object, () => void>();
const capturedErrorObjects = new WeakSet<object>();

type RendererErrorSource = RendererErrorPayload['source'];
type PersistRendererError = (
	payload: RendererErrorPayload,
) => Promise<RendererErrorReceipt | null> | RendererErrorReceipt | null;

export type RendererErrorEventTarget = {
	addEventListener(type: 'error' | 'unhandledrejection', listener: (event: unknown) => void): void;
	removeEventListener(
		type: 'error' | 'unhandledrejection',
		listener: (event: unknown) => void,
	): void;
};

export type RendererErrorConsole = {
	error(...values: unknown[]): void;
};

type InstallRendererErrorCaptureOptions = {
	target?: RendererErrorEventTarget;
	errorConsole?: RendererErrorConsole;
	persist?: PersistRendererError;
	now?: () => Date;
	route?: () => string | URL;
};

type CreateRendererErrorPayloadInput = {
	source: RendererErrorSource;
	error: unknown;
	route?: string | URL;
	now?: () => Date;
};

export type RendererErrorSinkStatus = Readonly<{
	attempted: number;
	persisted: number;
	failed: number;
	dropped: number;
	lastPayload: RendererErrorPayload | null;
	lastReceipt: RendererErrorReceipt | null;
}>;

let sinkStatus: RendererErrorSinkStatus = Object.freeze({
	attempted: 0,
	persisted: 0,
	failed: 0,
	dropped: 0,
	lastPayload: null,
	lastReceipt: null,
});
let captureWindowStartedAt = Number.NEGATIVE_INFINITY;
let capturesInWindow = 0;
let persistenceQueueDraining = false;
let nextAttemptId = 0;
let latestAttemptId = 0;
const persistenceQueue: Array<{
	payload: RendererErrorPayload;
	resolve(receipt: RendererErrorReceipt | null): void;
}> = [];

export function rendererErrorSinkSnapshot(): RendererErrorSinkStatus {
	return {
		...sinkStatus,
		lastPayload: sinkStatus.lastPayload ? clonePayload(sinkStatus.lastPayload) : null,
		lastReceipt: sinkStatus.lastReceipt ? { ...sinkStatus.lastReceipt } : null,
	};
}

export function installRendererErrorCapture(
	options: InstallRendererErrorCaptureOptions = {},
): () => void {
	const target = options.target ?? defaultEventTarget();
	if (!target) return () => undefined;
	if (installedTargets.has(target as object)) return () => undefined;

	const persist = options.persist ?? persistRendererError;
	const now = options.now ?? (() => new Date());
	const route = options.route ?? currentDiagnosticRoute;
	const errorConsole =
		options.errorConsole ?? (options.target === undefined ? defaultConsole() : null);
	const captureWindowError = (event: unknown): void => {
		const eventError = safeProperty(event, 'error');
		const message = safeProperty(event, 'message');
		if (typeof message === 'string' && DEFERRED_RESIZE_NOTIFICATIONS.test(message)) return;
		captureWith(
			'window-error',
			eventError ?? new Error(typeof message === 'string' && message ? message : 'Window error'),
			readRoute(route),
			now,
			persist,
		);
	};
	const captureUnhandledRejection = (event: unknown): void => {
		captureWith(
			'unhandled-rejection',
			safeProperty(event, 'reason') ?? new Error('Unhandled rejection'),
			readRoute(route),
			now,
			persist,
		);
	};

	try {
		target.addEventListener('error', captureWindowError);
		target.addEventListener('unhandledrejection', captureUnhandledRejection);
	} catch {
		try {
			target.removeEventListener('error', captureWindowError);
			target.removeEventListener('unhandledrejection', captureUnhandledRejection);
		} catch {}
		return () => undefined;
	}

	let restoreConsole = (): void => undefined;
	if (errorConsole) {
		try {
			const originalError = errorConsole.error;
			const captureConsoleError = (...values: unknown[]): void => {
				try {
					originalError.apply(errorConsole, values);
				} finally {
					const candidate = values.find(isErrorLike) ?? new Error(consoleErrorMessage(values));
					captureWith('console-error', candidate, readRoute(route), now, persist);
				}
			};
			errorConsole.error = captureConsoleError;
			restoreConsole = () => {
				if (errorConsole.error === captureConsoleError) errorConsole.error = originalError;
			};
		} catch {}
	}

	let live = true;
	const cleanup = (): void => {
		if (!live) return;
		live = false;
		try {
			target.removeEventListener('error', captureWindowError);
			target.removeEventListener('unhandledrejection', captureUnhandledRejection);
		} catch {}
		restoreConsole();
		installedTargets.delete(target as object);
	};
	installedTargets.set(target as object, cleanup);
	return cleanup;
}

function defaultConsole(): RendererErrorConsole | null {
	return typeof globalThis.console?.error === 'function' ? globalThis.console : null;
}

function isErrorLike(value: unknown): boolean {
	return (
		safeProperty(value, 'message') !== undefined ||
		safeProperty(value, 'stack') !== undefined ||
		safeProperty(value, 'name') !== undefined
	);
}

function consoleErrorMessage(values: readonly unknown[]): string {
	const message = values.map(safeString).filter(Boolean).join(' ');
	return message || 'console.error called without details';
}

export function captureRendererError(
	source: RendererErrorSource,
	error: unknown,
	route: string | URL = currentDiagnosticRoute(),
): RendererErrorPayload | null {
	return captureWith(source, error, route, () => new Date(), persistRendererError);
}

export async function persistRendererError(
	payload: RendererErrorPayload,
): Promise<RendererErrorReceipt | null> {
	return enqueueRendererErrorPersistence(payload);
}

function enqueueRendererErrorPersistence(
	payload: RendererErrorPayload,
): Promise<RendererErrorReceipt | null> {
	if (persistenceQueue.length >= MAX_PERSISTENCE_QUEUE) return Promise.resolve(null);
	return new Promise((resolve) => {
		persistenceQueue.push({ payload, resolve });
		void drainRendererErrorPersistenceQueue();
	});
}

async function drainRendererErrorPersistenceQueue(): Promise<void> {
	if (persistenceQueueDraining) return;
	persistenceQueueDraining = true;
	try {
		for (;;) {
			const job = persistenceQueue.shift();
			if (!job) return;
			let receipt: RendererErrorReceipt | null = null;
			for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
				try {
					receipt = await invoke('app.report-renderer-error', { payload: job.payload });
					break;
				} catch {
					await Promise.resolve();
				}
			}
			job.resolve(receipt);
		}
	} finally {
		persistenceQueueDraining = false;
		if (persistenceQueue.length > 0) void drainRendererErrorPersistenceQueue();
	}
}

function claimCaptureRateSlot(timestamp: number): boolean {
	const observedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
	if (
		!Number.isFinite(captureWindowStartedAt) ||
		observedAt < captureWindowStartedAt ||
		observedAt - captureWindowStartedAt >= CAPTURE_RATE_WINDOW_MS
	) {
		captureWindowStartedAt = observedAt;
		capturesInWindow = 0;
	}
	if (capturesInWindow >= MAX_CAPTURES_PER_WINDOW) return false;
	capturesInWindow += 1;
	return true;
}

export function createRendererErrorPayload({
	source,
	error,
	route = currentDiagnosticRoute(),
	now = () => new Date(),
}: CreateRendererErrorPayloadInput): RendererErrorPayload {
	const detail = normalizedError(error);
	return {
		schemaVersion: 1,
		occurredAt: utcTimestamp(now),
		source,
		route: publicDiagnosticRoute(route),
		error: detail,
	};
}

function captureWith(
	source: RendererErrorSource,
	error: unknown,
	route: string | URL,
	now: () => Date,
	persist: PersistRendererError,
): RendererErrorPayload | null {
	if (!markFirstCapture(error)) return null;
	let payload: RendererErrorPayload;
	try {
		payload = createRendererErrorPayload({ source, error, route, now });
	} catch {
		return null;
	}
	const attemptId = noteSinkAttempt(payload);
	if (!claimCaptureRateSlot(Date.parse(payload.occurredAt))) {
		noteSinkDrop();
		return payload;
	}
	try {
		const result = persist(payload);
		void (async () => {
			try {
				const receipt = await result;
				noteSinkResult(attemptId, receipt);
				if (!receipt) unmarkCapture(error);
			} catch {
				noteSinkFailure(attemptId);
				unmarkCapture(error);
			}
		})();
	} catch {
		noteSinkFailure(attemptId);
		unmarkCapture(error);
	}
	return payload;
}

function noteSinkAttempt(payload: RendererErrorPayload): number {
	const attemptId = ++nextAttemptId;
	latestAttemptId = attemptId;
	sinkStatus = Object.freeze({
		...sinkStatus,
		attempted: sinkStatus.attempted + 1,
		lastPayload: clonePayload(payload),
		lastReceipt: null,
	});
	return attemptId;
}

function noteSinkResult(attemptId: number, receipt: RendererErrorReceipt | null): void {
	if (!receipt) {
		noteSinkFailure(attemptId);
		return;
	}
	sinkStatus = Object.freeze({
		...sinkStatus,
		persisted: sinkStatus.persisted + 1,
		lastReceipt: attemptId === latestAttemptId ? { ...receipt } : sinkStatus.lastReceipt,
	});
}

function noteSinkFailure(attemptId: number): void {
	sinkStatus = Object.freeze({
		...sinkStatus,
		failed: sinkStatus.failed + 1,
		lastReceipt: attemptId === latestAttemptId ? null : sinkStatus.lastReceipt,
	});
}

function noteSinkDrop(): void {
	sinkStatus = Object.freeze({
		...sinkStatus,
		dropped: sinkStatus.dropped + 1,
	});
}

function clonePayload(payload: RendererErrorPayload): RendererErrorPayload {
	return { ...payload, error: { ...payload.error } };
}

function markFirstCapture(error: unknown): boolean {
	if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return true;
	const object = error as object;
	if (capturedErrorObjects.has(object)) return false;
	capturedErrorObjects.add(object);
	return true;
}

function unmarkCapture(error: unknown): void {
	if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return;
	capturedErrorObjects.delete(error as object);
}

function normalizedError(error: unknown): RendererErrorPayload['error'] {
	const candidateName = safeProperty(error, 'name');
	const candidateMessage = safeProperty(error, 'message');
	const candidateStack = safeProperty(error, 'stack');
	const fallbackName = error === null ? 'null' : typeof error;
	const fallbackMessage = safeString(error);
	const name = sanitizeDiagnosticText(
		typeof candidateName === 'string' ? candidateName : fallbackName,
		MAX_NAME_LENGTH,
		false,
		'Error',
	);
	const message = sanitizeDiagnosticText(
		typeof candidateMessage === 'string' ? candidateMessage : fallbackMessage,
		MAX_MESSAGE_LENGTH,
		false,
		'Renderer error',
	);
	const stack =
		typeof candidateStack === 'string' && candidateStack.trim()
			? sanitizeDiagnosticText(candidateStack, MAX_STACK_LENGTH, true, '') || null
			: null;
	return { name, message, stack };
}

export function sanitizeDiagnosticText(
	value: string,
	maxLength: number,
	preserveLines: boolean,
	fallback: string,
): string {
	const input = value.slice(0, maxLength * 8);
	const normalized = preserveLines
		? input.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, ' ')
		: input.replace(/[\u0000-\u001f\u007f]/gu, ' ');
	const redacted = redactSensitiveText(normalized).trim() || fallback;
	return boundCodePoints(redacted, maxLength);
}

function redactSensitiveText(value: string): string {
	return value
		.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/giu, '$1[redacted]@')
		.replace(/\b(bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '$1 [redacted]')
		.replace(
			/\b((?:[a-z0-9]+[_.-])*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key|token|secret|password|passwd|credentials?)|authorization|oauth[_-]?code|cookie|session)\b(["']?)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/giu,
			'$1$2$3[redacted]',
		)
		.replace(/\b(?:sk|org|ak)-[a-z0-9][a-z0-9._~+/=-]{15,}/giu, '[redacted-token]')
		.replace(/\b(?:gh[pousr]_[a-z0-9_]{20,}|github_pat_[a-z0-9_]{20,})\b/giu, '[redacted-token]')
		.replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/giu, '[redacted-jwt]')
		.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu, '[redacted-email]')
		.replace(/\/Users\/[^/\s]+/gu, '/Users/[user]')
		.replace(/\/home\/[^/\s]+/gu, '/home/[user]')
		.replace(/[a-z]:\\Users\\[^\\\s]+/giu, 'C:\\Users\\[user]');
}

export function publicDiagnosticRoute(value: string | URL): string {
	try {
		const url = value instanceof URL ? value : new URL(value, 'https://malini.local');
		const query = new URLSearchParams();
		const entries = [...url.searchParams.keys()]
			.slice(0, MAX_QUERY_ENTRIES)
			.map((key) => sanitizeQueryKey(key))
			.sort();
		for (const key of entries) query.append(key, '[redacted]');
		const search = query.toString();
		return boundCodePoints(`${url.pathname || '/'}${search ? `?${search}` : ''}`, MAX_ROUTE_LENGTH);
	} catch {
		return '/unparseable-renderer-route';
	}
}

function sanitizeQueryKey(key: string): string {
	const normalized = key.replace(/[^a-z0-9_.-]/giu, '_').slice(0, 64);
	return normalized || 'query';
}

function readRoute(route: () => string | URL): string | URL {
	try {
		return route();
	} catch {
		return '/';
	}
}

function defaultEventTarget(): RendererErrorEventTarget | null {
	if (
		typeof globalThis.addEventListener !== 'function' ||
		typeof globalThis.removeEventListener !== 'function'
	) {
		return null;
	}
	return {
		addEventListener: (type, listener) => globalThis.addEventListener(type, listener),
		removeEventListener: (type, listener) => globalThis.removeEventListener(type, listener),
	};
}

function safeProperty(
	value: unknown,
	key: 'error' | 'message' | 'name' | 'reason' | 'stack',
): unknown {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
		return undefined;
	try {
		return Reflect.get(value, key);
	} catch {
		return undefined;
	}
}

function safeString(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		return String(value);
	} catch {
		return 'Unprintable renderer error';
	}
}

function utcTimestamp(now: () => Date): string {
	try {
		const value = now();
		if (Number.isFinite(value.getTime())) return value.toISOString();
	} catch {}
	return new Date().toISOString();
}

function boundCodePoints(value: string, maxLength: number): string {
	return [...value].slice(0, maxLength).join('');
}
