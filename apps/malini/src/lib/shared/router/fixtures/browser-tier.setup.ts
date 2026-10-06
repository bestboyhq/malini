if (typeof globalThis.CSS === 'undefined') {
	Object.defineProperty(globalThis, 'CSS', { value: {}, writable: true });
}

if (typeof globalThis.CSS.escape !== 'function') {
	globalThis.CSS.escape = (value: string): string =>
		String(value).replace(/[^\w-]/gu, (character) => `\\${character}`);
}

if (typeof globalThis.ResizeObserver === 'undefined') {
	Object.defineProperty(globalThis, 'ResizeObserver', {
		writable: true,
		value: class {
			observe(): void {}
			unobserve(): void {}
			disconnect(): void {}
		},
	});
}

if (typeof globalThis.matchMedia !== 'function') {
	Object.defineProperty(globalThis, 'matchMedia', {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}),
	});
}

const animationPrototype: object = typeof Animation === 'undefined' ? {} : Animation.prototype;

if (typeof Element.prototype.animate !== 'function') {
	Element.prototype.animate = function stubAnimate(): Animation {
		return Object.assign(Object.create(animationPrototype), {
			cancel: () => undefined,
			finish: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			finished: Promise.resolve(),
		});
	};
}

if (typeof Range.prototype.getClientRects !== 'function') {
	Range.prototype.getClientRects = function emptyClientRects(): DOMRectList {
		return document.createElement('span').getClientRects();
	};
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
	Range.prototype.getBoundingClientRect = function emptyBoundingClientRect(): DOMRect {
		return document.createElement('span').getBoundingClientRect();
	};
}
