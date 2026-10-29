const prompts = new WeakMap<Element, HTMLElement>();
let observer: ResizeObserver | null = null;

function syncClamps(entries: readonly ResizeObserverEntry[]): void {
	const nodes = new Set(entries.flatMap(({ target }) => prompts.get(target) ?? []));
	const states = [...nodes].map((node) => {
		const body = node.querySelector('[data-prompt-body]');
		return { node, clamped: body && body.scrollHeight - body.clientHeight > 1 ? 'true' : 'false' };
	});
	for (const { node, clamped } of states) {
		if (node.dataset.clamped !== clamped) node.dataset.clamped = clamped;
	}
}

export function clampPrompt(node: HTMLElement): { destroy: () => void } {
	observer ??= new ResizeObserver(syncClamps);
	const targets = [node, node.querySelector('[data-prompt-body]')].filter(
		(target) => target !== null,
	);
	for (const target of targets) {
		prompts.set(target, node);
		observer.observe(target);
	}
	return { destroy: () => targets.forEach((target) => observer?.unobserve(target)) };
}
