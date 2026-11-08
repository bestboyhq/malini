import { APP_FULL_SCREEN_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

export function watchNativeFullScreen(): () => void {
	if (typeof document === 'undefined' || document.documentElement.dataset.nativeShell !== 'true') {
		return () => undefined;
	}

	const root = document.documentElement;
	let announced = false;
	const show = (fullScreen: boolean): void => {
		root.toggleAttribute('data-native-full-screen', fullScreen);
	};
	const stop = onPlatformEvent(APP_FULL_SCREEN_CHANGED_CHANNEL, ({ fullScreen }) => {
		announced = true;
		show(fullScreen);
	});
	void (async () => {
		try {
			const fullScreen = await invoke('app.full-screen', undefined);
			if (!announced) show(fullScreen);
		} catch (error) {
			console.error('[malini app] could not tell whether the window is full screen', error);
		}
	})();

	return () => {
		stop();
		root.removeAttribute('data-native-full-screen');
	};
}
