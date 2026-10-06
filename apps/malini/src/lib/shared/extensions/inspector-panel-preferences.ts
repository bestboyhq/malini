import type { InspectorPanel } from './inspector-panel';

export const INSPECTOR_PANEL_PREFERENCES_VERSION = 2 as const;
export const INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX = 'malini.extensions.inspector-panels-v2:';

export const LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX =
	'malini.extensions.inspector-panels-v1:';

export const REPOSITORY_FILES_PANEL_ID = 'malini.repository.files-panel';
export const REPOSITORY_CHANGES_PANEL_ID = 'malini.repository.changes-panel';

export type InspectorPanelPreferences = {
	version: typeof INSPECTOR_PANEL_PREFERENCES_VERSION;
	order: readonly string[];
	hidden: readonly string[];
	activeId: string | null;
};

export type InspectorPanelPresentation<TPanel extends InspectorPanel = InspectorPanel> = Readonly<{
	preferences: InspectorPanelPreferences;
	orderedPanels: readonly TPanel[];
	visiblePanels: readonly TPanel[];
	activePanel: TPanel | null;
}>;

function registrationOrder<TPanel extends InspectorPanel>(
	panels: readonly TPanel[],
): readonly TPanel[] {
	return panels
		.map((panel, registrationIndex) => ({ panel, registrationIndex }))
		.sort(
			(left, right) =>
				(left.panel.order ?? Number.MAX_SAFE_INTEGER) -
					(right.panel.order ?? Number.MAX_SAFE_INTEGER) ||
				left.registrationIndex - right.registrationIndex ||
				left.panel.id.localeCompare(right.panel.id),
		)
		.map(({ panel }) => panel);
}

function uniqueKnownIds(values: unknown, knownIds: ReadonlySet<string>): string[] {
	if (!Array.isArray(values)) return [];
	const result: string[] = [];
	const seen = new Set<string>();
	for (const id of values) {
		if (typeof id !== 'string') continue;
		if (!knownIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
}

function defaultActivePanelId(visible: readonly InspectorPanel[]): string | null {
	const files = visible.find((panel) => panel.id === REPOSITORY_FILES_PANEL_ID);
	return files?.id ?? visible[0]?.id ?? null;
}

export function defaultInspectorPanelPreferences(
	panels: readonly InspectorPanel[],
): InspectorPanelPreferences {
	const ordered = registrationOrder(panels);
	const visible = ordered.filter((panel) => panel.defaultVisible !== false);
	return {
		version: INSPECTOR_PANEL_PREFERENCES_VERSION,
		order: ordered.map((panel) => panel.id),
		hidden: ordered.filter((panel) => panel.defaultVisible === false).map((panel) => panel.id),
		activeId: defaultActivePanelId(visible),
	};
}

export function reconcileInspectorPanelPreferences(
	panels: readonly InspectorPanel[],
	preferences: InspectorPanelPreferences,
): InspectorPanelPreferences {
	const orderedPanels = registrationOrder(panels);
	const knownIds = new Set(orderedPanels.map((panel) => panel.id));
	const savedOrder = uniqueKnownIds(preferences.order, knownIds);
	const savedOrderSet = new Set(savedOrder);
	const order = [
		...savedOrder,
		...orderedPanels.map((panel) => panel.id).filter((id) => !savedOrderSet.has(id)),
	];
	const hidden = uniqueKnownIds(preferences.hidden, knownIds);
	for (const panel of orderedPanels) {
		if (!savedOrderSet.has(panel.id) && panel.defaultVisible === false) hidden.push(panel.id);
	}
	const hiddenSet = new Set(hidden);
	const visible = order.filter((id) => !hiddenSet.has(id));
	const activeId =
		preferences.activeId && visible.includes(preferences.activeId)
			? preferences.activeId
			: (visible[0] ?? null);

	return {
		version: INSPECTOR_PANEL_PREFERENCES_VERSION,
		order,
		hidden,
		activeId,
	};
}

export function isUnchosenLegacyInspectorPanelPreferences(
	panels: readonly InspectorPanel[],
	preferences: InspectorPanelPreferences,
): boolean {
	const registration = registrationOrder(panels).map((panel) => panel.id);
	return (
		preferences.hidden.length === 0 &&
		preferences.order.length === registration.length &&
		preferences.order.every((id, index) => id === registration[index]) &&
		preferences.activeId === (registration[0] ?? null)
	);
}

export function visibleInspectorPanels<TPanel extends InspectorPanel>(
	panels: readonly TPanel[],
	preferences: InspectorPanelPreferences,
): readonly TPanel[] {
	const panelById = new Map(panels.map((panel) => [panel.id, panel]));
	const hidden = new Set(preferences.hidden);
	return preferences.order
		.map((id) => panelById.get(id))
		.filter((panel): panel is TPanel => panel !== undefined && !hidden.has(panel.id));
}

export function orderedInspectorPanels<TPanel extends InspectorPanel>(
	panels: readonly TPanel[],
	preferences: InspectorPanelPreferences,
): readonly TPanel[] {
	const panelById = new Map(panels.map((panel) => [panel.id, panel]));
	return preferences.order
		.map((id) => panelById.get(id))
		.filter((panel): panel is TPanel => panel !== undefined);
}

export function projectInspectorPanelPresentation<TPanel extends InspectorPanel>(
	panels: readonly TPanel[],
	preferences: InspectorPanelPreferences,
): InspectorPanelPresentation<TPanel> {
	const reconciled = reconcileInspectorPanelPreferences(panels, preferences);
	const orderedPanels = orderedInspectorPanels(panels, reconciled);
	const visiblePanels = visibleInspectorPanels(panels, reconciled);
	return {
		preferences: reconciled,
		orderedPanels,
		visiblePanels,
		activePanel: visiblePanels.find((panel) => panel.id === reconciled.activeId) ?? null,
	};
}

export function selectInspectorPanel(
	preferences: InspectorPanelPreferences,
	panelId: string,
): InspectorPanelPreferences {
	if (!preferences.order.includes(panelId) || preferences.hidden.includes(panelId))
		return preferences;
	return { ...preferences, activeId: panelId };
}

export function setInspectorPanelVisible(
	preferences: InspectorPanelPreferences,
	panelId: string,
	visible: boolean,
): InspectorPanelPreferences {
	if (!preferences.order.includes(panelId)) return preferences;
	const hidden = new Set(preferences.hidden);
	if (visible) hidden.delete(panelId);
	else hidden.add(panelId);
	const visibleIds = preferences.order.filter((id) => !hidden.has(id));

	if (visibleIds.length === 0) return preferences;
	return {
		...preferences,
		hidden: preferences.order.filter((id) => hidden.has(id)),
		activeId:
			preferences.activeId && visibleIds.includes(preferences.activeId)
				? preferences.activeId
				: (visibleIds[0] ?? null),
	};
}

export function placeInspectorPanel(
	preferences: InspectorPanelPreferences,
	panelId: string,
	targetIndex: number,
): InspectorPanelPreferences {
	const index = preferences.order.indexOf(panelId);
	if (index < 0) return preferences;
	const target = Math.max(0, Math.min(preferences.order.length - 1, Math.floor(targetIndex)));
	if (target === index) return preferences;
	const order = preferences.order.filter((id) => id !== panelId);
	order.splice(target, 0, panelId);
	return { ...preferences, order };
}

export function moveInspectorPanel(
	preferences: InspectorPanelPreferences,
	panelId: string,
	direction: -1 | 1,
): InspectorPanelPreferences {
	const order = [...preferences.order];
	const index = order.indexOf(panelId);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= order.length) return preferences;
	[order[index], order[target]] = [order[target]!, order[index]!];
	return { ...preferences, order };
}
