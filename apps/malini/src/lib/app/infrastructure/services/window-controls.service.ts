import type { PopUpMenuArgs, WindowControl } from '$contract/commands';
import { APP_WINDOW_CONTROLS_CHANGED_CHANNEL, type WindowControlsState } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WindowControlsService {
	current(): Promise<WindowControlsState> {
		return invoke('app.window-controls', undefined);
	}

	onChange(listener: (state: WindowControlsState) => void): () => void {
		return onPlatformEvent(APP_WINDOW_CONTROLS_CHANGED_CHANNEL, listener);
	}

	press(control: WindowControl): Promise<void> {
		return invoke('app.press-window-control', { control });
	}

	popUpMenu(at: PopUpMenuArgs): Promise<void> {
		return invoke('app.pop-up-menu', at);
	}
}

export const windowControlsService = new WindowControlsService();
