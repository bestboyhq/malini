import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';

const DOM_GLOBALS = ['document', 'HTMLElement'] as const;

export async function withDom<T>(action: (window: DOMWindow) => Promise<T>): Promise<T> {
	const errors: Error[] = [];
	const virtualConsole = new VirtualConsole().on('jsdomError', (error) => errors.push(error));
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { virtualConsole });
	dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
	const previous = new Map(
		DOM_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
	);
	for (const name of DOM_GLOBALS) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value: dom.window[name],
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
