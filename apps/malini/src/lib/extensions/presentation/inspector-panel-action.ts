export type InspectorPanelAction = Readonly<{
	id: string;
	label: string;
	icon: string;
	run: () => void;
}>;
