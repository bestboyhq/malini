import { APP_MENU_COMMAND_CHOSEN_CHANNEL, type MenuCommand } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class MenuCommandsService {
	onCommand(listener: (command: MenuCommand) => void): () => void {
		let listening = true;
		const take = async (): Promise<void> => {
			const chosen = await invoke('app.take-menu-command', undefined).catch(() => null);
			if (listening && chosen) listener(chosen.command);
		};
		const stop = onPlatformEvent(APP_MENU_COMMAND_CHOSEN_CHANNEL, () => void take());
		void take();
		return () => {
			listening = false;
			stop();
		};
	}
}

export const menuCommandsService = new MenuCommandsService();
