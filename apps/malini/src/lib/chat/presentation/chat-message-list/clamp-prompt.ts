export function clampPrompt(node: HTMLElement): { destroy: () => void } {
	const body = node.querySelector('[data-prompt-body]');
	function sync(): void {
		if (!body) return;
		const clamped = body.scrollHeight - body.clientHeight > 1 ? 'true' : 'false';
		if (node.dataset.clamped !== clamped) node.dataset.clamped = clamped;
	}

	const observer = new ResizeObserver(sync);
	observer.observe(node);
	if (body) observer.observe(body);
	sync();
	return { destroy: () => observer.disconnect() };
}
