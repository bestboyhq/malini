import type { ThemeMode } from '$lib/app/domain/appearance';
import { syncNativeThemeCommand } from '$lib/app/application/commands/sync-native-theme.command';
import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

export function chooseThemeModeCommand(mode: ThemeMode): void {
	appearanceStore.chooseThemeMode(mode);
	appearanceDocumentService.applyTheme(appearanceStore.theme);
	syncNativeThemeCommand();
}
