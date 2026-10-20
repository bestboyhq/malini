declare module 'jsdom' {
	export type JSDOMWindow = Window & typeof globalThis & { close(): void };

	export class JSDOM {
		constructor(html?: string, options?: { url?: string; pretendToBeVisual?: boolean });
		readonly window: JSDOMWindow;
	}
}
