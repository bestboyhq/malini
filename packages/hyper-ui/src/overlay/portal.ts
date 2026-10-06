export function bodyPortal(node: HTMLElement): { destroy: () => void } {
	document.body.appendChild(node);
	return {
		destroy(): void {
			node.remove();
		},
	};
}
