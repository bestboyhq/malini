import type { InspectorPanel } from './inspector-panel';

export const GUTTER_CHANGES_PANEL_ID = 'malini.repository.files-panel';

export type GutterChangeTotals = Readonly<{
	additions: number;
	deletions: number;
}>;

export type GutterAction = Readonly<{
	id: string;
	label: string;
	icon: string;
	count: number | null;
}>;

export type GutterRow =
	| Readonly<{
			kind: 'panel';
			id: string;
			label: string;
			icon: string;
			changeTotals: GutterChangeTotals | null;
			closed: boolean;
	  }>
	| Readonly<{
			kind: 'action';
			id: string;
			label: string;
			icon: string;
			count: number | null;
	  }>;

export type GutterRowsInput = Readonly<{
	panels: readonly InspectorPanel[];
	hiddenPanelIds: readonly string[];
	changeTotals: GutterChangeTotals | null;
	actions?: readonly GutterAction[];
	changesPanelId?: string;
}>;

export function gutterRows(input: GutterRowsInput): readonly GutterRow[] {
	const changesPanelId = input.changesPanelId ?? GUTTER_CHANGES_PANEL_ID;
	const hidden = new Set(input.hiddenPanelIds);
	const panelRow = (panel: InspectorPanel): GutterRow => {
		const changes = panel.id === changesPanelId;
		return {
			kind: 'panel',
			id: panel.id,
			label: changes ? 'Changes' : panel.label,
			icon: changes ? 'changes' : panel.icon,
			changeTotals: changes ? input.changeTotals : null,
			closed: hidden.has(panel.id),
		};
	};
	const actionRows = (input.actions ?? []).map(({ id, label, icon, count }): GutterRow => ({
		kind: 'action',
		id,
		label,
		icon,
		count,
	}));

	return [
		...input.panels.filter((panel) => panel.id === changesPanelId).map(panelRow),
		...actionRows,
		...input.panels.filter((panel) => panel.id !== changesPanelId).map(panelRow),
	];
}
