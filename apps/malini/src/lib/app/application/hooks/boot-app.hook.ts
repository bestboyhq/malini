import { followSystemThemeCommand } from '$lib/app/application/commands/follow-system-theme.command';
import { requestCloseCommand } from '$lib/app/application/commands/request-close.command';
import { runMenuChoiceCommand } from '$lib/app/application/commands/run-menu-choice.command';
import { showUpdateStatusCommand } from '$lib/app/application/commands/show-update-status.command';
import { syncNativeThemeCommand } from '$lib/app/application/commands/sync-native-theme.command';
import { appearanceDocumentService } from '$lib/app/infrastructure/services/appearance-document.service';
import { menuCommandsService } from '$lib/app/infrastructure/services/menu-commands.service';
import { watchNativeChromeZoom } from '$lib/app/infrastructure/services/native-chrome-zoom.service';
import { streamingService } from '$lib/app/infrastructure/services/streaming.service';
import { updatesService } from '$lib/app/infrastructure/services/updates.service';
import { windowLifecycleService } from '$lib/app/infrastructure/services/window-lifecycle.service';
import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';
import { updateStatusStore } from '$lib/app/infrastructure/stores/update-status.store.svelte';

export function bootAppHook(): () => void {
	const stopWatchingZoom = watchNativeChromeZoom();
	const stopFollowingSystemTheme =
		appearanceDocumentService.watchSystemTheme(followSystemThemeCommand);
	syncNativeThemeCommand();
	const stopWatchingStreaming = watchStreaming();
	const stopWatchingUpdates = watchUpdateStatus();
	const stopAnsweringMenu = menuCommandsService.onCommand(runMenuChoiceCommand);
	if (!windowLifecycleService.isNativeWindow()) {
		return () => {
			stopAnsweringMenu();
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
		stopAnsweringMenu();
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

function watchUpdateStatus(): () => void {
	const stop = updatesService.onStatus(showUpdateStatusCommand);
	void (async () => {
		try {
			updateStatusStore.observe(await updatesService.status());
		} catch (error) {
			console.error('[malini updates] could not read the update status', error);
		}
	})();
	return stop;
}
