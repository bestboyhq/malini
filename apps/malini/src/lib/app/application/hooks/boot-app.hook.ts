import { followSystemThemeCommand } from '$lib/app/application/commands/follow-system-theme.command';
import { requestCloseCommand } from '$lib/app/application/commands/request-close.command';
import { syncNativeThemeCommand } from '$lib/app/application/commands/sync-native-theme.command';
import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { watchNativeChromeZoom } from '$lib/app/infrastructure/services/native-chrome-zoom.service';
import { streamingService } from '$lib/app/infrastructure/services/streaming.service';
import { updatesService } from '$lib/app/infrastructure/services/updates.service';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';
import { stagedUpdateStore } from '$lib/app/infrastructure/stores/staged-update.store.svelte';
import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';

export function bootAppHook(): () => void {
	const stopWatchingZoom = watchNativeChromeZoom();
	const stopFollowingSystemTheme =
		appearanceDocumentService.watchSystemTheme(followSystemThemeCommand);
	syncNativeThemeCommand();
	const stopWatchingStreaming = watchStreaming();
	const stopWatchingUpdates = watchStagedUpdate();
	if (!windowLifecycleService.isNativeWindow()) {
		return () => {
			stopWatchingUpdates();
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
		stopWatchingUpdates();
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

function watchStagedUpdate(): () => void {
	const stop = updatesService.onStaged((version) => stagedUpdateStore.stage(version));
	void (async () => {
		try {
			stagedUpdateStore.stage((await updatesService.staged()) ?? stagedUpdateStore.version);
		} catch (error) {
			console.error('[malini updates] could not tell whether an update is ready', error);
		}
	})();
	return stop;
}
