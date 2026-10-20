const STORAGE_KEY = 'malini.chat.transcript-heights:v1';
const MAX_REMEMBERED_CHATS = 50;
const PERSISTED_PREFIX = 'run:';

type Heights = Map<string, number>;

class TranscriptHeightsStore {
	#heights: Map<string, Heights> | null = null;

	heightsFor(sessionId: string): ReadonlyMap<string, number> {
		return this.#loaded().get(sessionId) ?? new Map();
	}

	remember(sessionId: string, heights: ReadonlyMap<string, number>): void {
		const sessions = this.#loaded();
		sessions.delete(sessionId);
		sessions.set(sessionId, new Map(heights));
		for (const oldest of sessions.keys()) {
			if (sessions.size <= MAX_REMEMBERED_CHATS) break;
			sessions.delete(oldest);
		}
		saveHeights(sessions);
	}

	forget(sessionIds: readonly string[]): void {
		const sessions = this.#loaded();
		let changed = false;
		for (const sessionId of sessionIds) changed = sessions.delete(sessionId) || changed;
		if (changed) saveHeights(sessions);
	}

	#loaded(): Map<string, Heights> {
		this.#heights ??= loadHeights();
		return this.#heights;
	}
}

function loadHeights(): Map<string, Heights> {
	const sessions = new Map<string, Heights>();
	try {
		const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]');
		if (!Array.isArray(stored)) return sessions;
		for (const entry of stored) {
			if (!Array.isArray(entry)) continue;
			const [sessionId, raw] = entry;
			if (typeof sessionId !== 'string' || !Array.isArray(raw)) continue;
			sessions.set(sessionId, readHeights(raw));
		}
	} catch {}
	return sessions;
}

function readHeights(raw: readonly unknown[]): Heights {
	const heights: Heights = new Map();
	for (const pair of raw) {
		if (!Array.isArray(pair)) continue;
		const [key, height] = pair;
		if (typeof key !== 'string' || typeof height !== 'number') continue;
		if (Number.isFinite(height) && height >= 0) heights.set(key, height);
	}
	return heights;
}

function saveHeights(sessions: ReadonlyMap<string, Heights>): void {
	const persisted = [...sessions].map(([sessionId, heights]) => [
		sessionId,
		[...heights].filter(([key]) => key.startsWith(PERSISTED_PREFIX)),
	]);
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
	} catch {}
}

export const transcriptHeights = new TranscriptHeightsStore();
