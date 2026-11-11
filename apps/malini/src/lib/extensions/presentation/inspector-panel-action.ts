export type InspectorPanelAction = Readonly<{
	id: string;
	label: string;
	icon: string;
	count?: number;
	run: () => void;
}>;
