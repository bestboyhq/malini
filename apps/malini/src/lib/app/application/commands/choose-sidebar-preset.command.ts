import { presetArranged, type SidebarPreset } from '$lib/app/domain/onboarding';
import { sidebarArrangementStore } from '$lib/app/infrastructure/stores/sidebar-arrangement.store.svelte';

export function chooseSidebarPresetCommand(change: Partial<SidebarPreset>): void {
	sidebarArrangementStore.save(presetArranged(sidebarArrangementStore.arrangement, change));
}
