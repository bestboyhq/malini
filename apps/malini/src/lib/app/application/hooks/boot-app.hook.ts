import { followSystemThemeCommand } from '$lib/app/application/commands/follow-system-theme.command';
import { requestCloseCommand } from '$lib/app/application/commands/request-close.command';
import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { watchNativeChromeZoom } from '$lib/app/infrastructure/services/native-chrome-zoom.service';
import { streamingService } from '$lib/app/infrastructure/services/streaming.service';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';
import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';

export function bootAppHook(): () => void {
	const stopWatchingZoom = watchNativeChromeZoom();
	const stopFollowingSystemTheme =
		appearanceDocumentService.watchSystemTheme(followSystemThemeCommand);
	const stopWatchingStreaming = watchStreaming();
	if (!windowLifecycleService.isNativeWindow()) {
		return () => {
			stopWatchingStreaming();
			stopFollowingSystemTheme();
			stopWatchingZoom();
		};
	}

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
		stopWatchingStreaming();
		stopFollowingSystemTheme();
		stopWatchingZoom();
	};
}

function watchStreaming(): () => void {
	const stop = streamingService.onChange((streaming) =>
		streamerModeStore.observeStreaming(streaming),
	);
	void (async () => {
		try {
			streamerModeStore.observeStreaming(await streamingService.current());
		} catch (error) {
			console.error('[malini app] could not tell whether a streaming app is running', error);
		}
	})();
	return stop;
}
