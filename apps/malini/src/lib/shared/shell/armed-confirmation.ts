const ARMED_CONFIRMATION_TIMEOUT_MS = 10_000;

export function disarmOnDismiss(disarm: () => void): () => void {
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') disarm();
	};
	const onPointerDown = (event: Event): void => {
		const target = event.target;
		if (target instanceof Element && target.closest('[data-armed]')) return;
		disarm();
	};
	const expiry = setTimeout(disarm, ARMED_CONFIRMATION_TIMEOUT_MS);
	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('pointerdown', onPointerDown, true);
	return () => {
		clearTimeout(expiry);
		window.removeEventListener('keydown', onKeyDown, true);
		window.removeEventListener('pointerdown', onPointerDown, true);
	};
}
