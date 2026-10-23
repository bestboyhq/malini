declare global {
	namespace App {}

	interface Window {
		logdash?: Readonly<{
			track(name: `malini_web_${string}`, props?: Record<string, string | number | boolean>): void;
		}>;
	}
}

export {};
