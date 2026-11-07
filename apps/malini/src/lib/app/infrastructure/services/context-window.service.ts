import {
	CONTEXT_WINDOW_SETTING,
	OPTIMIZE_CONTEXT_SETTING,
	contextWindowOf,
	optimizesContext,
} from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class ContextWindowService {
	async read(): Promise<{ tokens: number; optimized: boolean }> {
		const settings = await invoke('app.list-settings', undefined);
		return {
			tokens: contextWindowOf(settings[CONTEXT_WINDOW_SETTING]),
			optimized: optimizesContext(settings[OPTIMIZE_CONTEXT_SETTING]),
		};
	}

	write(tokens: number): Promise<void> {
		return invoke('app.set-setting', { key: CONTEXT_WINDOW_SETTING, value: String(tokens) });
	}

	optimize(optimized: boolean): Promise<void> {
		return invoke('app.set-setting', {
			key: OPTIMIZE_CONTEXT_SETTING,
			value: optimized ? 'on' : 'off',
		});
	}
}

export const contextWindowService = new ContextWindowService();
