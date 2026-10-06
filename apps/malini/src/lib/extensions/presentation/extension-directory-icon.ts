import { bundledExtensionManifests } from './extension-directory-catalog';

const PREFERRED_PANEL_BY_EXTENSION = new Map<string, string>([
	['malini.repository', 'malini.repository.files-panel'],
]);

export function extensionDirectoryIconName(extensionId: string): string {
	const manifest = bundledExtensionManifests.get(extensionId);
	const panels = manifest?.contributes?.panels ?? [];
	const preferredPanelId = PREFERRED_PANEL_BY_EXTENSION.get(extensionId);
	const preferred = preferredPanelId ? panels.find(({ id }) => id === preferredPanelId) : panels[0];
	return preferred?.icon ?? panels[0]?.icon ?? 'extension';
}
