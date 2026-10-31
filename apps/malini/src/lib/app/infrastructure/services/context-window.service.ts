import { CONTEXT_WINDOW_SETTING, contextWindowOf } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ContextWindowService {
	async read(): Promise<number> {
		const settings = await invoke('app.list-settings', undefined);
		return contextWindowOf(settings[CONTEXT_WINDOW_SETTING]);
	}

	write(tokens: number): Promise<void> {
		return invoke('app.set-setting', { key: CONTEXT_WINDOW_SETTING, value: String(tokens) });
	}
}

export const contextWindowService = new ContextWindowService();
