export function bodyPortal(node: HTMLElement): { destroy: () => void } {
	const focused = document.activeElement;
	document.body.appendChild(node);
	if (focused instanceof HTMLElement && node.contains(focused)) {
		focused.focus({ preventScroll: true });
	}
	return {
		destroy(): void {
			node.remove();
		},
	};
}
