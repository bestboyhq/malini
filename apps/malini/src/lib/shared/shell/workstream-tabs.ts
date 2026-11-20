export type WorkstreamDocumentOpening = Readonly<{
	id: string;
	label: string;
	icon: string;
	tooltip: string;
	pinned?: boolean;
}>;

export type WorkstreamDocument = Omit<WorkstreamDocumentOpening, 'pinned'> &
	Readonly<{
		preview: boolean;
	}>;

export type WorkstreamChatTab = Readonly<{ kind: 'chat'; id: string }>;

export type WorkstreamDocumentTab = WorkstreamDocument & Readonly<{ kind: 'document' }>;

export type WorkstreamTab = WorkstreamChatTab | WorkstreamDocumentTab;

type ClosedChatSpot = Readonly<{ id: string; afterKey: string | null }>;

const CLOSED_CHAT_SPOTS_KEPT = 10;

export type WorkstreamTabs = Readonly<{
	tabs: readonly WorkstreamTab[];
	activeDocumentId: string | null;
	routedChatId: string | null;
	anchorKey: string | null;
	fresh: boolean;
	closedChats: readonly ClosedChatSpot[];
}>;

export const NO_WORKSTREAM_TABS: WorkstreamTabs = {
	tabs: [],
	activeDocumentId: null,
	routedChatId: null,
	anchorKey: null,
	fresh: false,
	closedChats: [],
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
	const { id, label, icon, tooltip, pinned = false } = opening;
	const opened: WorkstreamDocumentTab = {
		kind: 'document',
		id,
		label,
		icon,
		tooltip,
		preview: !pinned,
	};
	const existing = findDocument(state, id);
	if (existing) {
		const preview = existing.preview && !pinned;
		return settle({
			...state,
			tabs: replaceTab(state.tabs, existing, { ...existing, label, icon, tooltip, preview }),
			activeDocumentId: id,
		});
	}

	const preview = pinned
		? undefined
		: workstreamDocuments(state).find((document) => document.preview);
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
		fresh: true,
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
	const addedIds = new Set(added.map(({ id }) => id));
	const reopened = state.closedChats.filter(({ id }) => addedIds.has(id));
	const reopenedIds = new Set(reopened.map(({ id }) => id));
	const anchorKey = state.fresh ? null : state.anchorKey;
	const fresh =
		routedChatId === null ||
		(state.fresh &&
			(known.has(routedChatId)
				? routedChatId === state.routedChatId
				: !chatIds.includes(routedChatId)));
	if (added.length === 0 && routedChatId === state.routedChatId && fresh === state.fresh) {
		return state;
	}
	const opened = insertAfter(
		state.tabs,
		anchorKey,
		added.filter(({ id }) => !reopenedIds.has(id)),
	);
	return settle({
		...state,
		tabs: reopened.reduce((tabs, spot) => returnToSpot(tabs, spot, anchorKey), opened),
		routedChatId,
		fresh,
		closedChats: state.closedChats.filter(({ id }) => !reopenedIds.has(id)),
	});
}

export function closeWorkstreamChat(state: WorkstreamTabs, id: string): WorkstreamTabs {
	const index = state.tabs.findIndex((tab) => tab.kind === 'chat' && tab.id === id);
	if (index === -1) return state;
	const before = state.tabs[index - 1];
	const spot: ClosedChatSpot = { id, afterKey: before ? workstreamTabKey(before) : null };
	return settle({
		...state,
		tabs: state.tabs.filter((_, tabIndex) => tabIndex !== index),
		closedChats: [spot, ...state.closedChats.filter((closed) => closed.id !== id)].slice(
			0,
			CLOSED_CHAT_SPOTS_KEPT,
		),
	});
}

export type WorkstreamTabPlacement = 'before' | 'after';

export function moveWorkstreamTab(
	state: WorkstreamTabs,
	movedKey: string,
	targetKey: string,
	placement: WorkstreamTabPlacement,
): WorkstreamTabs {
	const moved = state.tabs.find((tab) => workstreamTabKey(tab) === movedKey);
	const others = state.tabs.filter((tab) => tab !== moved);
	const targetIndex = others.findIndex((tab) => workstreamTabKey(tab) === targetKey);
	if (!moved || targetIndex < 0) return state;
	const at = placement === 'before' ? targetIndex : targetIndex + 1;
	const placed = moved.kind === 'document' ? { ...moved, preview: false } : moved;
	const tabs = [...others.slice(0, at), placed, ...others.slice(at)];
	if (tabs.every((tab, index) => tab === state.tabs[index])) return state;
	return { ...state, tabs };
}

export function readWorkstreamTabs(value: unknown): WorkstreamTabs {
	if (!isRecord(value) || !Array.isArray(value.tabs)) return NO_WORKSTREAM_TABS;
	const tabs = value.tabs.filter(isWorkstreamTab);
	const state: WorkstreamTabs = {
		tabs,
		activeDocumentId: typeof value.activeDocumentId === 'string' ? value.activeDocumentId : null,
		routedChatId: typeof value.routedChatId === 'string' ? value.routedChatId : null,
		anchorKey: typeof value.anchorKey === 'string' ? value.anchorKey : null,
		fresh: value.fresh === true,
		closedChats: Array.isArray(value.closedChats)
			? value.closedChats.filter(isClosedChatSpot).slice(0, CLOSED_CHAT_SPOTS_KEPT)
			: [],
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

function returnToSpot(
	tabs: readonly WorkstreamTab[],
	spot: ClosedChatSpot,
	fallbackKey: string | null,
): readonly WorkstreamTab[] {
	const chat: WorkstreamChatTab = { kind: 'chat', id: spot.id };
	if (spot.afterKey === null) return [chat, ...tabs];
	return insertAfter(tabs, hasTab(tabs, spot.afterKey) ? spot.afterKey : fallbackKey, [chat]);
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

function isClosedChatSpot(value: unknown): value is ClosedChatSpot {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		(typeof value.afterKey === 'string' || value.afterKey === null)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
