import {
	closeWorkstreamChat,
	closeWorkstreamDocument,
	leaveWorkstreamDocuments,
	NO_WORKSTREAM_TABS,
	openWorkstreamDocument,
	pinWorkstreamDocument,
	readWorkstreamTabs,
	selectWorkstreamDocument,
	startWorkstreamFreshChat,
	syncWorkstreamChats,
	type WorkstreamDocumentOpening,
	type WorkstreamTabs,
} from './workstream-tabs';

export const WORKSTREAM_TABS_STORAGE_KEY_PREFIX = 'malini.workstream-tabs-v1:';

class WorkstreamTabsStore {
	#revision = $state(0);
	readonly #loaded = new Map<string, WorkstreamTabs>();

	for(workstreamId: string): WorkstreamTabs {
		this.#revision;
		if (!workstreamId) return NO_WORKSTREAM_TABS;
		const loaded = this.#loaded.get(workstreamId);
		if (loaded) return loaded;
		const stored = loadWorkstreamTabs(workstreamId);
		this.#loaded.set(workstreamId, stored);
		return stored;
	}

	open(workstreamId: string, opening: WorkstreamDocumentOpening): void {
		this.#update(workstreamId, (current) => openWorkstreamDocument(current, opening));
	}

	pin(workstreamId: string, documentId: string): void {
		this.#update(workstreamId, (current) => pinWorkstreamDocument(current, documentId));
	}

	select(workstreamId: string, documentId: string): void {
		this.#update(workstreamId, (current) => selectWorkstreamDocument(current, documentId));
	}

	leave(workstreamId: string): void {
		this.#update(workstreamId, leaveWorkstreamDocuments);
	}

	close(workstreamId: string, documentId: string): void {
		this.#update(workstreamId, (current) => closeWorkstreamDocument(current, documentId));
	}

	syncChats(workstreamId: string, chatIds: readonly string[], routedChatId: string | null): void {
		this.#update(workstreamId, (current) => syncWorkstreamChats(current, chatIds, routedChatId));
	}

	startFreshChat(workstreamId: string): void {
		this.#update(workstreamId, startWorkstreamFreshChat);
	}

	closeChat(workstreamId: string, chatId: string): void {
		this.#update(workstreamId, (current) => closeWorkstreamChat(current, chatId));
	}

	reset(): void {
		this.#loaded.clear();
		this.#revision += 1;
	}

	#update(workstreamId: string, change: (current: WorkstreamTabs) => WorkstreamTabs): void {
		if (!workstreamId) return;
		const current = this.for(workstreamId);
		const next = change(current);
		if (next === current) return;
		this.#loaded.set(workstreamId, next);
		saveWorkstreamTabs(workstreamId, next);
		this.#revision += 1;
	}
}

function loadWorkstreamTabs(workstreamId: string): WorkstreamTabs {
	try {
		const stored = globalThis.localStorage?.getItem(storageKey(workstreamId)) ?? null;
		return stored === null ? NO_WORKSTREAM_TABS : readWorkstreamTabs(JSON.parse(stored));
	} catch {
		return NO_WORKSTREAM_TABS;
	}
}

function saveWorkstreamTabs(workstreamId: string, tabs: WorkstreamTabs): void {
	try {
		globalThis.localStorage?.setItem(storageKey(workstreamId), JSON.stringify(tabs));
	} catch {}
}

function storageKey(workstreamId: string): string {
	return `${WORKSTREAM_TABS_STORAGE_KEY_PREFIX}${workstreamId}`;
}

export const workstreamTabs = new WorkstreamTabsStore();
