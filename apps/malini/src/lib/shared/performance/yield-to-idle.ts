export function yieldToIdle(timeoutMs: number): Promise<void> {
	return new Promise((resolve) => {
		if (typeof globalThis.requestIdleCallback === 'function') {
			globalThis.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
			return;
		}
		setTimeout(resolve, 0);
	});
}
