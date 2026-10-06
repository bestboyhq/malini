export type WorkstreamDocumentOpening = Readonly<{
	id: string;
	label: string;
	icon: string;
	tooltip: string;
}>;

export type WorkstreamDocument = WorkstreamDocumentOpening &
	Readonly<{
		preview: boolean;
	}>;

export type WorkstreamChatTab = Readonly<{ kind: 'chat'; id: string }>;

export type WorkstreamDocumentTab = WorkstreamDocument & Readonly<{ kind: 'document' }>;

export type WorkstreamTab = WorkstreamChatTab | WorkstreamDocumentTab;

export type WorkstreamTabs = Readonly<{
	tabs: readonly WorkstreamTab[];
	activeDocumentId: string | null;
	routedChatId: string | null;
	anchorKey: string | null;
	fresh: Readonly<{ afterKey: string | null }> | null;
}>;

export const NO_WORKSTREAM_TABS: WorkstreamTabs = {
	tabs: [],
	activeDocumentId: null,
	routedChatId: null,
	anchorKey: null,
	fresh: null,
};

export function workstreamTabKey(tab: WorkstreamTab): string {
	return `${tab.kind}:${tab.id}`;
}

export function workstreamDocuments(state: WorkstreamTabs): readonly WorkstreamDocumentTab[] {
	return state.tabs.filter((tab): tab is WorkstreamDocumentTab => tab.kind === 'document');
}

export function openWorkstreamDocument(
	state: WorkstreamTabs,
	opening: WorkstreamDocumentOpening,
): WorkstreamTabs {
	const { id, label, icon, tooltip } = opening;
	const opened: WorkstreamDocumentTab = {
		kind: 'document',
		id,
		label,
		icon,
		tooltip,
		preview: true,
	};
	const existing = findDocument(state, id);
	if (existing) {
		return settle({
			...state,
			tabs: replaceTab(state.tabs, existing, { ...existing, label, icon, tooltip }),
			activeDocumentId: id,
		});
	}

	const preview = workstreamDocuments(state).find((document) => document.preview);
	if (preview) {
		return settle({
			...state,
			tabs: replaceTab(state.tabs, preview, opened),
			activeDocumentId: id,
		});
	}

	return settle({
		...state,
		tabs: insertAfter(state.tabs, currentTabKey(state) ?? state.anchorKey, [opened]),
		activeDocumentId: id,
	});
}

export function pinWorkstreamDocument(state: WorkstreamTabs, id: string): WorkstreamTabs {
	const document = findDocument(state, id);
	if (!document?.preview) return state;
	return { ...state, tabs: replaceTab(state.tabs, document, { ...document, preview: false }) };
}

export function selectWorkstreamDocument(state: WorkstreamTabs, id: string): WorkstreamTabs {
	if (state.activeDocumentId === id || !findDocument(state, id)) return state;
	return settle({ ...state, activeDocumentId: id });
}

export function leaveWorkstreamDocuments(state: WorkstreamTabs): WorkstreamTabs {
	if (state.activeDocumentId === null) return state;
	return settle({ ...state, activeDocumentId: null });
}

export function closeWorkstreamDocument(state: WorkstreamTabs, id: string): WorkstreamTabs {
	const documents = workstreamDocuments(state);
	const index = documents.findIndex((document) => document.id === id);
	if (index < 0) return state;
	const tabs = state.tabs.filter((tab) => tab.kind !== 'document' || tab.id !== id);
	if (state.activeDocumentId !== id) return settle({ ...state, tabs });
	const adjacent = documents[index + 1] ?? documents[index - 1] ?? null;
	return settle({ ...state, tabs, activeDocumentId: adjacent?.id ?? null });
}

export function startWorkstreamFreshChat(state: WorkstreamTabs): WorkstreamTabs {
	if (state.fresh && state.activeDocumentId === null) return state;
	return settle({
		...state,
		activeDocumentId: null,
		fresh: state.fresh ?? { afterKey: currentTabKey(state) ?? state.anchorKey },
	});
}

export function syncWorkstreamChats(
	state: WorkstreamTabs,
	chatIds: readonly string[],
	routedChatId: string | null,
): WorkstreamTabs {
	const known = new Set(state.tabs.filter((tab) => tab.kind === 'chat').map(({ id }) => id));
	const added = chatIds
		.filter((id) => !known.has(id))
		.map((id): WorkstreamChatTab => ({ kind: 'chat', id }));
	const fresh = routedChatId === null ? (state.fresh ?? { afterKey: state.anchorKey }) : null;
	if (added.length === 0 && routedChatId === state.routedChatId && fresh === state.fresh) {
		return state;
	}
	return settle({
		...state,
		tabs: insertAfter(state.tabs, state.fresh ? state.fresh.afterKey : state.anchorKey, added),
		routedChatId,
		fresh,
	});
}

export function closeWorkstreamChat(state: WorkstreamTabs, id: string): WorkstreamTabs {
	if (!state.tabs.some((tab) => tab.kind === 'chat' && tab.id === id)) return state;
	return settle({
		...state,
		tabs: state.tabs.filter((tab) => tab.kind !== 'chat' || tab.id !== id),
	});
}

export function readWorkstreamTabs(value: unknown): WorkstreamTabs {
	if (!isRecord(value) || !Array.isArray(value.tabs)) return NO_WORKSTREAM_TABS;
	const tabs = value.tabs.filter(isWorkstreamTab);
	const state: WorkstreamTabs = {
		tabs,
		activeDocumentId: typeof value.activeDocumentId === 'string' ? value.activeDocumentId : null,
		routedChatId: typeof value.routedChatId === 'string' ? value.routedChatId : null,
		anchorKey: typeof value.anchorKey === 'string' ? value.anchorKey : null,
		fresh: isRecord(value.fresh)
			? { afterKey: typeof value.fresh.afterKey === 'string' ? value.fresh.afterKey : null }
			: null,
	};
	return settle({
		...state,
		activeDocumentId:
			state.activeDocumentId && findDocument(state, state.activeDocumentId)
				? state.activeDocumentId
				: null,
	});
}

function currentTabKey(state: WorkstreamTabs): string | null {
	const key = state.activeDocumentId
		? `document:${state.activeDocumentId}`
		: state.routedChatId
			? `chat:${state.routedChatId}`
			: null;
	return key && hasTab(state.tabs, key) ? key : null;
}

function settle(state: WorkstreamTabs): WorkstreamTabs {
	const anchorKey =
		currentTabKey(state) ??
		(state.anchorKey && hasTab(state.tabs, state.anchorKey) ? state.anchorKey : null);
	return anchorKey === state.anchorKey ? state : { ...state, anchorKey };
}

function insertAfter(
	tabs: readonly WorkstreamTab[],
	anchorKey: string | null,
	inserted: readonly WorkstreamTab[],
): readonly WorkstreamTab[] {
	if (inserted.length === 0) return tabs;
	const anchorIndex = anchorKey ? tabs.findIndex((tab) => workstreamTabKey(tab) === anchorKey) : -1;
	const at = anchorIndex >= 0 ? anchorIndex + 1 : tabs.length;
	return [...tabs.slice(0, at), ...inserted, ...tabs.slice(at)];
}

function replaceTab(
	tabs: readonly WorkstreamTab[],
	replaced: WorkstreamTab,
	replacement: WorkstreamTab,
): readonly WorkstreamTab[] {
	return tabs.map((tab) => (tab === replaced ? replacement : tab));
}

function findDocument(state: WorkstreamTabs, id: string): WorkstreamDocumentTab | undefined {
	return workstreamDocuments(state).find((document) => document.id === id);
}

function hasTab(tabs: readonly WorkstreamTab[], key: string): boolean {
	return tabs.some((tab) => workstreamTabKey(tab) === key);
}

function isWorkstreamTab(value: unknown): value is WorkstreamTab {
	if (!isRecord(value) || typeof value.id !== 'string') return false;
	if (value.kind === 'chat') return true;
	return (
		value.kind === 'document' &&
		typeof value.label === 'string' &&
		typeof value.icon === 'string' &&
		typeof value.tooltip === 'string' &&
		typeof value.preview === 'boolean'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
