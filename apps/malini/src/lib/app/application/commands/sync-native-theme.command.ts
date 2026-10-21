import { nativeThemeService } from '$lib/app/infrastructure/services/native-theme.service';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

export function syncNativeThemeCommand(): void {
	if (!windowLifecycleService.isNativeWindow()) return;
	void (async () => {
		try {
			await nativeThemeService.follow(appearanceStore.themeMode);
		} catch (error) {
			console.error('[malini appearance] native windows and pages do not follow the theme', error);
		}
	})();
}
