function canScroll(element: Element, deltaY: number): boolean {
	const { overflowY } = getComputedStyle(element);
	if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
	if (deltaY < 0) return element.scrollTop > 0;
	return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
}

export function passScrollToTheSite(): void {
	if (window.parent === window) return;
	window.addEventListener(
		'wheel',
		(event) => {
			if (event.ctrlKey || event.deltaY === 0) return;
			for (
				let at = event.target instanceof Element ? event.target : null;
				at;
				at = at.parentElement
			) {
				if (canScroll(at, event.deltaY)) return;
			}
			window.parent.scrollBy({ top: event.deltaY, behavior: 'instant' });
		},
		{ passive: true },
	);
}
