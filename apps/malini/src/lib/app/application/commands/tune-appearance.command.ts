import { tunedAppearance, type Appearance } from '$lib/app/domain/appearance';
import { greyStylesheet } from '$lib/app/domain/grey-ramp';
import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

export function tuneAppearanceCommand(patch: Partial<Appearance>): void {
	const appearance = tunedAppearance(appearanceStore.appearance, patch);
	appearanceStore.tune(appearance);
	appearanceDocumentService.applyGreys(greyStylesheet(appearance));
}
