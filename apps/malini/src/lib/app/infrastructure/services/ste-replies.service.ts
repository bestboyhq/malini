import { STE_REPLIES_SETTING, writesSte } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class SteRepliesService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return writesSte(settings[STE_REPLIES_SETTING]);
	}

	write(on: boolean): Promise<void> {
		return invoke('app.set-setting', { key: STE_REPLIES_SETTING, value: on ? 'on' : 'off' });
	}
}

export const steRepliesService = new SteRepliesService();
