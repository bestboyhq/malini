const ELLIPSIS = '…';

function ellipsisWidth(element: HTMLElement): number {
	const context = document.createElement('canvas').getContext('2d');
	if (!context) return 0;
	context.font = getComputedStyle(element).font;
	return context.measureText(ELLIPSIS).width;
}

export function clippedText(element: HTMLElement): string {
	if (element.scrollWidth <= element.clientWidth) return '';
	const limit = element.getBoundingClientRect().right - ellipsisWidth(element);
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	let clipped = false;
	let rest = '';
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent ?? '';
		let from = clipped ? 0 : text.length;
		for (let index = 0; !clipped && index < text.length; index += 1) {
			range.setStart(node, index);
			range.setEnd(node, index + 1);
			if (range.getBoundingClientRect().right > limit) {
				from = index;
				clipped = true;
			}
		}
		rest += text.slice(from);
	}
	return rest;
}
