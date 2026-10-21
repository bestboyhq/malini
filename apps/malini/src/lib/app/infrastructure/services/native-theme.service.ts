import type { ThemeMode } from '$lib/app/domain/appearance';
import { invoke } from '$shared/port/invoke';

class NativeThemeService {
	follow(mode: ThemeMode): Promise<void> {
		return invoke('app.theme-mode', { mode });
	}
}

export const nativeThemeService = new NativeThemeService();
