import type { ContractEvents, EventChannel } from '$contract/events';
import { platformBridge } from './platform';

export function hasPlatformBridge(): boolean {
	if (typeof window === 'undefined') return false;
	const bridge = window.malini;
	return typeof bridge?.invoke === 'function' && typeof bridge.on === 'function';
}

export function onPlatformEvent<Channel extends EventChannel>(
	channel: Channel,
	listener: (payload: ContractEvents[Channel]) => void,
): () => void {
	return platformBridge().on(channel, listener);
}

export function platformZoomFactor(): number | null {
	if (typeof window === 'undefined') return null;
	const zoomFactor = window.malini?.windowChrome?.zoomFactor;
	if (typeof zoomFactor !== 'function') return null;
	const factor = zoomFactor();
	return Number.isFinite(factor) && factor > 0 ? factor : null;
}
