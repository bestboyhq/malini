import type { InspectorPanel } from './inspector-panel';

export const INSPECTOR_MIN_WIDTH = 360;

export function inspectorMinWidth(
	panels: readonly InspectorPanel[],
	hiddenPanelIds: readonly string[],
	floor: number = INSPECTOR_MIN_WIDTH,
): number {
	const hidden = new Set(hiddenPanelIds);
	let widest = floor;
	for (const panel of panels) {
		if (hidden.has(panel.id)) continue;
		const declared = panel.minWidth;
		if (declared !== undefined && declared > widest) widest = declared;
	}
	return widest;
}
