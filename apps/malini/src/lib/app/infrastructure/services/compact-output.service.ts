import { COMPACT_OUTPUT_SETTING, compactsOutput } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class CompactOutputService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return compactsOutput(settings[COMPACT_OUTPUT_SETTING]);
	}

	write(on: boolean): Promise<void> {
		return invoke('app.set-setting', { key: COMPACT_OUTPUT_SETTING, value: on ? 'on' : 'off' });
	}
}

export const compactOutputService = new CompactOutputService();
