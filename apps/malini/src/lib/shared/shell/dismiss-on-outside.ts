import { isWithinOverlaySurface, registerEscapeScope } from '$hyper-ui/overlay';

export function dismissOnOutside(ondismiss: () => void, keep: string) {
	return (node: HTMLElement): (() => void) => {
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Element) || node.contains(target)) return;
			if (isWithinOverlaySurface(target) || target.closest(keep)) return;
			ondismiss();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		const releaseEscape = registerEscapeScope(ondismiss);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			releaseEscape();
		};
	};
}
