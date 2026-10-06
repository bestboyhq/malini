import type { InspectorPanel } from './inspector-panel';

export const EXTENSION_GUTTER_WIDTH = '14rem';

export const GUTTER_CHANGES_PANEL_ID = 'malini.repository.files-panel';

export type GutterChangeTotals = Readonly<{
	additions: number;
	deletions: number;
}>;

export type GutterRow = Readonly<{
	panelId: string;
	label: string;
	icon: string;
	changeTotals: GutterChangeTotals | null;
	closed: boolean;
}>;

export type GutterRowsInput = Readonly<{
	panels: readonly InspectorPanel[];
	hiddenPanelIds: readonly string[];
	changeTotals: GutterChangeTotals | null;
	changesPanelId?: string;
}>;

export function gutterRows(input: GutterRowsInput): readonly GutterRow[] {
	const changesPanelId = input.changesPanelId ?? GUTTER_CHANGES_PANEL_ID;
	const hidden = new Set(input.hiddenPanelIds);
	const pinned = input.panels.filter((panel) => panel.id === changesPanelId);
	const rest = input.panels.filter((panel) => panel.id !== changesPanelId);

	return [...pinned, ...rest].map((panel) => ({
		panelId: panel.id,
		label: panel.label,
		icon: panel.icon,
		changeTotals: panel.id === changesPanelId ? input.changeTotals : null,
		closed: hidden.has(panel.id),
	}));
}
