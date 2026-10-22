import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	PREVIOUS_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANELS_EVERYWHERE_KEY,
	applyInspectorPanelEverywhereChoices,
	defaultInspectorPanelPreferences,
	hideDefaultHiddenInspectorPanels,
	isUnchosenLegacyInspectorPanelPreferences,
	reconcileInspectorPanelPreferences,
	type InspectorPanelEverywhereChoice,
	type InspectorPanelPreferences,
} from './inspector-panel-preferences';
import type { InspectorPanel } from './inspector-panel';
import type { InspectorPreferenceStorage } from './inspector-preference-storage';

const LEGACY_INSPECTOR_PANEL_PREFERENCES_VERSION = 1;
const PREVIOUS_INSPECTOR_PANEL_PREFERENCES_VERSION = 2;

type StoredPreferences = Readonly<{ preferences: InspectorPanelPreferences; savedAt: number }>;

export function browserInspectorPreferenceStorage(): InspectorPreferenceStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function loadInspectorPanelPreferences(
	workstreamId: string,
	panels: readonly InspectorPanel[],
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): InspectorPanelPreferences {
	const stored = loadWorkstreamPreferences(workstreamId, panels, storage);
	return reconcileInspectorPanelPreferences(
		panels,
		applyInspectorPanelEverywhereChoices(
			stored.preferences,
			stored.savedAt,
			loadEverywhereChoices(storage),
		),
	);
}

export function inspectorPanelHiddenEverywhere(
	panelId: string,
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): boolean {
	return loadEverywhereChoices(storage).get(panelId)?.hidden === true;
}

export function saveInspectorPanelHiddenEverywhere(
	panelId: string,
	hidden: boolean,
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): void {
	if (!storage) return;
	const choices = new Map(loadEverywhereChoices(storage)).set(panelId, { hidden, at: Date.now() });
	try {
		storage.setItem(INSPECTOR_PANELS_EVERYWHERE_KEY, JSON.stringify(Object.fromEntries(choices)));
	} catch {}
}

function loadEverywhereChoices(
	storage: InspectorPreferenceStorage | null,
): ReadonlyMap<string, InspectorPanelEverywhereChoice> {
	try {
		const value: unknown = JSON.parse(storage?.getItem(INSPECTOR_PANELS_EVERYWHERE_KEY) ?? '{}');
		if (!isRecord(value)) return new Map();
		return new Map(
			Object.entries(value).filter((entry): entry is [string, InspectorPanelEverywhereChoice] =>
				isEverywhereChoice(entry[1]),
			),
		);
	} catch {
		return new Map();
	}
}

function isEverywhereChoice(value: unknown): value is InspectorPanelEverywhereChoice {
	return isRecord(value) && typeof value.hidden === 'boolean' && typeof value.at === 'number';
}

function loadWorkstreamPreferences(
	workstreamId: string,
	panels: readonly InspectorPanel[],
	storage: InspectorPreferenceStorage | null,
): StoredPreferences {
	const defaults = { preferences: defaultInspectorPanelPreferences(panels), savedAt: 0 };
	if (!workstreamId || !storage) return defaults;

	const saved = readStoredPreferences(
		storage,
		storageKey(workstreamId),
		INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (saved) {
		return { ...saved, preferences: reconcileInspectorPanelPreferences(panels, saved.preferences) };
	}

	const previous = readStoredPreferences(
		storage,
		`${PREVIOUS_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${workstreamId}`,
		PREVIOUS_INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (previous) {
		return {
			...previous,
			preferences: reconcileInspectorPanelPreferences(
				panels,
				hideDefaultHiddenInspectorPanels(panels, previous.preferences),
			),
		};
	}

	const legacy = readStoredPreferences(
		storage,
		legacyStorageKey(workstreamId),
		LEGACY_INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (!legacy || isUnchosenLegacyInspectorPanelPreferences(panels, legacy.preferences)) {
		return defaults;
	}
	return { ...legacy, preferences: reconcileInspectorPanelPreferences(panels, legacy.preferences) };
}

export function saveInspectorPanelPreferences(
	workstreamId: string,
	preferences: InspectorPanelPreferences,
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): void {
	if (!workstreamId || !storage) return;
	try {
		storage.setItem(
			storageKey(workstreamId),
			JSON.stringify({ ...preferences, savedAt: Date.now() }),
		);
	} catch {}
}

function storageKey(workstreamId: string): string {
	return `${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${workstreamId}`;
}

function legacyStorageKey(workstreamId: string): string {
	return `${LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${workstreamId}`;
}

function readStoredPreferences(
	storage: InspectorPreferenceStorage,
	key: string,
	expectedVersion: number,
): StoredPreferences | null {
	try {
		const stored = storage.getItem(key);
		if (stored === null) return null;
		const value: unknown = JSON.parse(stored);
		if (!isRecord(value) || value.version !== expectedVersion) return null;
		return {
			preferences: {
				version: INSPECTOR_PANEL_PREFERENCES_VERSION,
				order: Array.isArray(value.order)
					? value.order.filter((id: unknown): id is string => typeof id === 'string')
					: [],
				hidden: Array.isArray(value.hidden)
					? value.hidden.filter((id: unknown): id is string => typeof id === 'string')
					: [],
				activeId: typeof value.activeId === 'string' ? value.activeId : null,
			},
			savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
		};
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
