import type { PlatformBridge } from './bridge';
import { createFakePlatform } from './fake/create-fake-platform';

let bridgeForTest: PlatformBridge | null = null;
let fakeRequested = false;
let fakeBridge: PlatformBridge | null = null;

export function platformBridge(): PlatformBridge {
	if (bridgeForTest) return bridgeForTest;
	const native = nativeBridge();
	if (native && !fakeRequested) return native;
	fakeBridge ??= createFakePlatform();
	return fakeBridge;
}

export function setPlatformForTest(bridge: PlatformBridge | null): void {
	bridgeForTest = bridge;
	fakeBridge = null;
}

export function requestFakePlatform(): void {
	fakeRequested = true;
}

function nativeBridge(): PlatformBridge | null {
	if (typeof window === 'undefined') return null;
	const bridge: Partial<PlatformBridge> | undefined = window.malini;
	if (typeof bridge?.invoke !== 'function' || typeof bridge.on !== 'function') return null;
	return window.malini;
}
