import type { InspectorPanel } from './inspector-panel';

export type PanelRegistration = Readonly<{
	dispose(): void | Promise<void>;
}>;

export type PanelRegistryPort<TPanel extends InspectorPanel = InspectorPanel> = Readonly<{
	register(panel: TPanel): PanelRegistration;
}>;
