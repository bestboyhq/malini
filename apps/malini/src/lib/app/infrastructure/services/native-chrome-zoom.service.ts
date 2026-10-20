import { platformZoomFactor } from '$shared/port/events';

export function watchNativeChromeZoom(): () => void {
	if (typeof document === 'undefined' || document.documentElement.dataset.nativeShell !== 'true') {
		return () => undefined;
	}
	if (platformZoomFactor() === null) {
		return () => undefined;
	}

	const root = document.documentElement;
	let media: MediaQueryList | null = null;

	function apply(): void {
		const factor = platformZoomFactor();
		if (factor !== null) root.style.setProperty('--native-zoom', String(factor));
	}

	function onDppxChange(): void {
		apply();
		arm();
	}

	function arm(): void {
		media?.removeEventListener('change', onDppxChange);
		media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		media.addEventListener('change', onDppxChange, { once: true });
	}

	apply();
	arm();

	return () => {
		media?.removeEventListener('change', onDppxChange);
		media = null;
		root.style.removeProperty('--native-zoom');
	};
}
