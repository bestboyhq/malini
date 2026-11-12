import type { InspectorPanel } from './inspector-panel';

export const GUTTER_CHANGES_PANEL_ID = 'malini.repository.files-panel';

export const GUTTER_ROW_CLASS =
	'hover:bg-surface-100-hover hover:text-fg-default focus-visible:bg-surface-100-hover focus-visible:ring-border-default/50 flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left text-xs transition-[color,border-color] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40';

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
