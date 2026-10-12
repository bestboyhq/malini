import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

export function followSystemThemeCommand(prefersDark: boolean): void {
	appearanceStore.followSystem(prefersDark);
	appearanceDocumentService.applyTheme(appearanceStore.theme);
}
