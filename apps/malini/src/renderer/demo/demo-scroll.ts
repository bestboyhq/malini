export function passScrollToTheSite(): void {
	if (window.parent === window) return;
	const chain = document.createElement('style');
	chain.textContent = '* { overscroll-behavior: auto !important; }';
	document.head.append(chain);
}
