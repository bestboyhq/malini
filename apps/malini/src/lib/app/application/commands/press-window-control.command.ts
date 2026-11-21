import type { WindowControl } from '$contract/commands';
import { windowControlsService } from '$lib/app/infrastructure/services/window-controls.service';

export function pressWindowControlCommand(control: WindowControl): void {
	void (async () => {
		try {
			await windowControlsService.press(control);
		} catch (error) {
			console.error(`[malini app] the window did not ${control}`, error);
		}
	})();
}
