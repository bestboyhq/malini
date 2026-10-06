import { requestCloseCommand } from '$lib/app/application/commands/request-close.command';
import { watchNativeChromeZoom } from '$lib/app/infrastructure/services/native-chrome-zoom.service';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';

export function bootAppHook(): () => void {
	const stopWatchingZoom = watchNativeChromeZoom();
	if (!windowLifecycleService.isNativeWindow()) return stopWatchingZoom;

	let disposed = false;
	let disarmCloseGuard: (() => void) | null = null;

	void (async () => {
		try {
			const disarm = await windowLifecycleService.armCloseGuard(requestCloseCommand);
			if (disposed) {
				disarm();
				return;
			}
			disarmCloseGuard = disarm;
		} catch (error) {
			console.error('[malini lifecycle] close confirmation is not armed', error);
		}
	})();

	return () => {
		disposed = true;
		disarmCloseGuard?.();
		disarmCloseGuard = null;
		stopWatchingZoom();
	};
}
