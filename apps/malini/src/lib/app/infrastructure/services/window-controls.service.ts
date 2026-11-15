import type { PopUpMenuArgs, WindowControlsTint } from '$contract/commands';
import { hasPlatformBridge, platformOs } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WindowControlsService {
	drawnByChromium(): boolean {
		return hasPlatformBridge() && platformOs() !== 'darwin';
	}

	tint(tint: WindowControlsTint): Promise<void> {
		return invoke('app.tint-window-controls', tint);
	}

	popUpMenu(at: PopUpMenuArgs): Promise<void> {
		return invoke('app.pop-up-menu', at);
	}
}

export const windowControlsService = new WindowControlsService();
