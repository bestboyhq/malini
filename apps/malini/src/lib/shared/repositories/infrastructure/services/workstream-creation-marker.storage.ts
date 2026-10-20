import type { WorkstreamCreationContext } from '$shared/repositories/domain/workstream-creation-context';

const PENDING_CREATED_WORKSTREAMS_KEY = 'malini.chat.pending-created-workstreams-v1';
const CREATED_WORKSTREAM_CONTEXT_KEY = 'malini.chat.created-workstream-context-v1';
const MAX_PENDING_CREATED_WORKSTREAMS = 128;
const fallbackMarkers = new Map<string, WorkstreamCreationContext | null>();

type WorkstreamCreationMarkerStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): WorkstreamCreationMarkerStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function markWorkstreamCreated(
	workstreamId: string,
	storage: WorkstreamCreationMarkerStorage | null = browserStorage(),
	context?: WorkstreamCreationContext,
): boolean {
	const id = workstreamId.trim();
	if (!id) return false;
	const normalizedContext = context && validContext(context) ? normalizeContext(context) : null;
	if (!storage) {
		rememberFallback(id, normalizedContext);
		return false;
	}
	try {
		const pending = readPending(storage).filter((candidate) => candidate !== id);
		const nextPending = [id, ...pending].slice(0, MAX_PENDING_CREATED_WORKSTREAMS);
		storage.setItem(PENDING_CREATED_WORKSTREAMS_KEY, JSON.stringify(nextPending));
		const contexts = readContexts(storage);
		if (normalizedContext) contexts[id] = normalizedContext;
		else delete contexts[id];
		const pendingIds = new Set(nextPending);
		storage.setItem(
			CREATED_WORKSTREAM_CONTEXT_KEY,
			JSON.stringify(
				Object.fromEntries(
					Object.entries(contexts).filter(([workstreamId]) => pendingIds.has(workstreamId)),
				),
			),
		);
		fallbackMarkers.delete(id);
		return true;
	} catch {
		rememberFallback(id, normalizedContext);
		return false;
	}
}

export function workstreamCreationContext(
	workstreamId: string,
	storage: WorkstreamCreationMarkerStorage | null = browserStorage(),
): WorkstreamCreationContext | null {
	const id = workstreamId.trim();
	if (!id) return null;
	if (fallbackMarkers.has(id)) return fallbackMarkers.get(id) ?? null;
	if (!storage) return null;
	try {
		return readContexts(storage)[id] ?? null;
	} catch {
		return null;
	}
}

export function isWorkstreamCreationPending(
	workstreamId: string,
	storage: WorkstreamCreationMarkerStorage | null = browserStorage(),
): boolean {
	const id = workstreamId.trim();
	if (!id) return false;
	if (fallbackMarkers.has(id)) return true;
	if (!storage) return false;
	try {
		return readPending(storage).includes(id);
	} catch {
		return false;
	}
}

export function consumeWorkstreamCreation(
	workstreamId: string,
	storage: WorkstreamCreationMarkerStorage | null = browserStorage(),
): boolean {
	const id = workstreamId.trim();
	if (!id) return false;
	const fallback = fallbackMarkers.has(id);
	if (!storage) {
		fallbackMarkers.delete(id);
		return fallback;
	}
	try {
		const pending = readPending(storage);
		if (!pending.includes(id) && !fallback) return false;
		storage.setItem(
			PENDING_CREATED_WORKSTREAMS_KEY,
			JSON.stringify(pending.filter((candidate) => candidate !== id)),
		);
		const contexts = readContexts(storage);
		delete contexts[id];
		storage.setItem(CREATED_WORKSTREAM_CONTEXT_KEY, JSON.stringify(contexts));
		fallbackMarkers.delete(id);
		return true;
	} catch {
		if (fallback) {
			fallbackMarkers.delete(id);
			return true;
		}
		return false;
	}
}

function rememberFallback(id: string, context: WorkstreamCreationContext | null): void {
	fallbackMarkers.delete(id);
	fallbackMarkers.set(id, context);
	while (fallbackMarkers.size > MAX_PENDING_CREATED_WORKSTREAMS) {
		const oldest = fallbackMarkers.keys().next().value as string | undefined;
		if (!oldest) break;
		fallbackMarkers.delete(oldest);
	}
}

function readContexts(
	storage: WorkstreamCreationMarkerStorage,
): Record<string, WorkstreamCreationContext> {
	const value = storage.getItem(CREATED_WORKSTREAM_CONTEXT_KEY);
	if (value === null) return {};
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed)) return {};
	const contexts: Record<string, WorkstreamCreationContext> = {};
	for (const [workstreamId, context] of Object.entries(parsed)) {
		if (workstreamId.trim() && validContext(context)) {
			contexts[workstreamId] = normalizeContext(context);
		}
	}
	return contexts;
}

function validContext(value: unknown): value is WorkstreamCreationContext {
	if (!isRecord(value) || typeof value.task !== 'string' || !value.task.trim()) return false;
	if (value.source === undefined) return true;
	return (
		isRecord(value.source) &&
		typeof value.source.provider === 'string' &&
		Boolean(value.source.provider.trim()) &&
		typeof value.source.resourceId === 'string' &&
		Boolean(value.source.resourceId.trim()) &&
		(value.source.title === undefined || typeof value.source.title === 'string') &&
		(value.source.url === undefined || typeof value.source.url === 'string')
	);
}

function normalizeContext(context: WorkstreamCreationContext): WorkstreamCreationContext {
	return {
		task: context.task.trim(),
		...(context.source
			? {
					source: {
						provider: context.source.provider.trim(),
						resourceId: context.source.resourceId.trim(),
						...(context.source.title?.trim() ? { title: context.source.title.trim() } : {}),
						...(context.source.url?.trim() ? { url: context.source.url.trim() } : {}),
					},
				}
			: {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPending(storage: WorkstreamCreationMarkerStorage): string[] {
	const value = storage.getItem(PENDING_CREATED_WORKSTREAMS_KEY);
	if (value === null) return [];
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) return [];
	return [
		...new Set(
			parsed.filter(
				(candidate): candidate is string =>
					typeof candidate === 'string' && candidate.trim().length > 0,
			),
		),
	];
}
