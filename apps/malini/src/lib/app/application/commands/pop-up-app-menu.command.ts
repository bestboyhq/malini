import type { PopUpMenuArgs } from '$contract/commands';
import { windowControlsService } from '$lib/app/infrastructure/services/window-controls.service';

export function popUpAppMenuCommand(at: PopUpMenuArgs): void {
	void (async () => {
		try {
			await windowControlsService.popUpMenu(at);
		} catch (error) {
			console.error('[malini app] the menu did not open', error);
		}
	})();
}
