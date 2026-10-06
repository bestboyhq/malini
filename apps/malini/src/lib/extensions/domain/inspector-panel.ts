export type InspectorPanel = Readonly<{
	id: string;
	label: string;
	icon: string;
	order?: number | undefined;
	defaultVisible?: boolean | undefined;
	minWidth?: number | undefined;
}>;
