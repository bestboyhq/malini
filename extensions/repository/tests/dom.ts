import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';

const DOM_GLOBALS = [
	'window',
	'Window',
	'document',
	'HTMLElement',
	'Node',
	'Text',
	'MutationObserver',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'getComputedStyle',
] as const;

export async function withDom<T>(action: (window: DOMWindow) => Promise<T>): Promise<T> {
	const errors: Error[] = [];
	const virtualConsole = new VirtualConsole().on('jsdomError', (error) => errors.push(error));
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		virtualConsole,
		pretendToBeVisual: true,
	});
	dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
	dom.window.Range.prototype.getClientRects = () => noRects();
	dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
	const previous = new Map(
		DOM_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
	);
	for (const name of DOM_GLOBALS) {
		const value: unknown = dom.window[name];
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value: typeof value === 'function' && /^[a-z]/u.test(name) ? value.bind(dom.window) : value,
		});
	}
	try {
		const result = await action(dom.window);
		const [error] = errors;
		if (error) throw error;
		return result;
	} finally {
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
		dom.window.close();
	}
}

function noRects(): DOMRectList {
	const rects: DOMRect[] = [];
	return Object.assign(rects, { item: () => null });
}
