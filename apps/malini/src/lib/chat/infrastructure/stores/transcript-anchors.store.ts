import {
	readTranscriptAnchor,
	sameTranscriptAnchor,
	type TranscriptAnchor,
} from '$lib/chat/domain/transcript-anchor';

const STORAGE_KEY = 'malini.chat.transcript-anchors:v1';
const MAX_REMEMBERED_CHATS = 200;

class TranscriptAnchorsStore {
	#anchors: Map<string, TranscriptAnchor> | null = null;

	anchorFor(sessionId: string): TranscriptAnchor | null {
		return this.#loaded().get(sessionId) ?? null;
	}

	remember(sessionId: string, anchor: TranscriptAnchor | null): void {
		const anchors = this.#loaded();
		if (sameTranscriptAnchor(anchors.get(sessionId) ?? null, anchor)) return;
		anchors.delete(sessionId);
		if (anchor) anchors.set(sessionId, anchor);
		for (const oldest of anchors.keys()) {
			if (anchors.size <= MAX_REMEMBERED_CHATS) break;
			anchors.delete(oldest);
		}
		saveAnchors(anchors);
	}

	forget(sessionIds: readonly string[]): void {
		const anchors = this.#loaded();
		let changed = false;
		for (const sessionId of sessionIds) changed = anchors.delete(sessionId) || changed;
		if (changed) saveAnchors(anchors);
	}

	reset(): void {
		this.#anchors = null;
	}

	#loaded(): Map<string, TranscriptAnchor> {
		this.#anchors ??= loadAnchors();
		return this.#anchors;
	}
}

function loadAnchors(): Map<string, TranscriptAnchor> {
	const anchors = new Map<string, TranscriptAnchor>();
	try {
		const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]');
		if (!Array.isArray(stored)) return anchors;
		for (const entry of stored) {
			if (!Array.isArray(entry)) continue;
			const [sessionId, raw] = entry;
			const anchor = readTranscriptAnchor(raw);
			if (typeof sessionId === 'string' && anchor) anchors.set(sessionId, anchor);
		}
	} catch {}
	return anchors;
}

function saveAnchors(anchors: ReadonlyMap<string, TranscriptAnchor>): void {
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...anchors]));
	} catch {}
}

export const transcriptAnchors = new TranscriptAnchorsStore();
