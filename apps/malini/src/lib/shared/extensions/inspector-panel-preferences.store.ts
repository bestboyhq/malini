import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	defaultInspectorPanelPreferences,
	isUnchosenLegacyInspectorPanelPreferences,
	reconcileInspectorPanelPreferences,
	type InspectorPanelPreferences,
} from './inspector-panel-preferences';
import type { InspectorPanel } from './inspector-panel';
import type { InspectorPreferenceStorage } from './inspector-preference-storage';

const LEGACY_INSPECTOR_PANEL_PREFERENCES_VERSION = 1;

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
	const defaults = defaultInspectorPanelPreferences(panels);
	if (!workstreamId || !storage) return defaults;

	const saved = readStoredPreferences(
		storage,
		storageKey(workstreamId),
		INSPECTOR_PANEL_PREFERENCES_VERSION,
	);
	if (saved) return reconcileInspectorPanelPreferences(panels, saved);

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
