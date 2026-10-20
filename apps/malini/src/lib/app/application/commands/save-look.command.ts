import { rememberedLooks } from '$lib/app/domain/look';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

export function saveLookCommand(): void {
	appearanceStore.keepLooks(
		rememberedLooks(appearanceStore.looks, appearanceStore.appearance, Date.now()),
	);
}
