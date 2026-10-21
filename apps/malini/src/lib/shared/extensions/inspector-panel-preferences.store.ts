import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	PREVIOUS_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	SHARED_INSPECTOR_PANEL_VISIBILITY_KEY,
	applySharedInspectorPanelVisibility,
	defaultInspectorPanelPreferences,
	hideDefaultHiddenInspectorPanels,
	isUnchosenLegacyInspectorPanelPreferences,
	reconcileInspectorPanelPreferences,
	sharedInspectorPanelVisibilityChanges,
	type InspectorPanelPreferences,
} from './inspector-panel-preferences';
import type { InspectorPanel } from './inspector-panel';
import type { InspectorPreferenceStorage } from './inspector-preference-storage';

const LEGACY_INSPECTOR_PANEL_PREFERENCES_VERSION = 1;
const PREVIOUS_INSPECTOR_PANEL_PREFERENCES_VERSION = 2;

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
	return reconcileInspectorPanelPreferences(
		panels,
		applySharedInspectorPanelVisibility(
			loadWorkstreamPreferences(workstreamId, panels, storage),
			loadSharedVisibility(storage),
		),
	);
}

export function saveSharedInspectorPanelVisibility(
	before: InspectorPanelPreferences,
	after: InspectorPanelPreferences,
	sharedPanelIds: ReadonlySet<string>,
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): void {
	const changes = sharedInspectorPanelVisibilityChanges(before, after, sharedPanelIds);
	if (changes.size === 0 || !storage) return;
	const visibility = new Map([...loadSharedVisibility(storage), ...changes]);
	try {
		storage.setItem(
			SHARED_INSPECTOR_PANEL_VISIBILITY_KEY,
			JSON.stringify(Object.fromEntries(visibility)),
		);
	} catch {}
}

function loadSharedVisibility(
	storage: InspectorPreferenceStorage | null,
): ReadonlyMap<string, boolean> {
	try {
		const value: unknown = JSON.parse(
			storage?.getItem(SHARED_INSPECTOR_PANEL_VISIBILITY_KEY) ?? '{}',
		);
		if (!isRecord(value)) return new Map();
		return new Map(
			Object.entries(value).filter(
				(entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
			),
		);
	} catch {
		return new Map();
	}
}

function loadWorkstreamPreferences(
	workstreamId: string,
	panels: readonly InspectorPanel[],
	storage: InspectorPreferenceStorage | null,
): InspectorPanelPreferences {
	const defaults = defaultInspectorPanelPreferences(panels);
	if (!workstreamId || !storage) return defaults;

	const saved = readStoredPreferences(
		storage,
		storageKey(workstreamId),
		INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (saved) return reconcileInspectorPanelPreferences(panels, saved);

	const previous = readStoredPreferences(
		storage,
		`${PREVIOUS_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${workstreamId}`,
		PREVIOUS_INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (previous) {
		return reconcileInspectorPanelPreferences(
			panels,
			hideDefaultHiddenInspectorPanels(panels, previous),
		);
	}

	const legacy = readStoredPreferences(
		storage,
		legacyStorageKey(workstreamId),
		LEGACY_INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (!legacy || isUnchosenLegacyInspectorPanelPreferences(panels, legacy)) return defaults;
	return reconcileInspectorPanelPreferences(panels, legacy);
}

export function saveInspectorPanelPreferences(
	workstreamId: string,
	preferences: InspectorPanelPreferences,
	storage: InspectorPreferenceStorage | null = browserInspectorPreferenceStorage(),
): void {
	if (!workstreamId || !storage) return;
	try {
		storage.setItem(storageKey(workstreamId), JSON.stringify(preferences));
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
): InspectorPanelPreferences | null {
	try {
		const stored = storage.getItem(key);
		if (stored === null) return null;
		const value: unknown = JSON.parse(stored);
		if (!isRecord(value) || value.version !== expectedVersion) return null;
		return {
			version: INSPECTOR_PANEL_PREFERENCES_VERSION,
			order: Array.isArray(value.order)
				? value.order.filter((id: unknown): id is string => typeof id === 'string')
				: [],
			hidden: Array.isArray(value.hidden)
				? value.hidden.filter((id: unknown): id is string => typeof id === 'string')
				: [],
			activeId: typeof value.activeId === 'string' ? value.activeId : null,
		};
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
