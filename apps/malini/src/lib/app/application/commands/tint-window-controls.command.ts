import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { windowControlsService } from '$lib/app/infrastructure/services/window-controls.service';

export function tintWindowControlsCommand(): void {
	if (!windowControlsService.drawnByChromium()) return;
	void (async () => {
		try {
			await windowControlsService.tint(appearanceDocumentService.windowControlsTint());
		} catch (error) {
			console.error('[malini appearance] the window controls do not follow the theme', error);
		}
	})();
}
