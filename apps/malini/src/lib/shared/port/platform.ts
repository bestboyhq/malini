import type { PlatformBridge } from './bridge';

export function platformBridge(): PlatformBridge {
	return window.malini;
}
