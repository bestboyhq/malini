export type ViewportRepositionListener = () => void;

export type ViewportRepositionTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const listeners = new Set<ViewportRepositionListener>();

let boundTarget: ViewportRepositionTarget | null = null;

function notifySubscribers(): void {
	for (const listener of [...listeners]) listener();
}

function resolveTarget(): ViewportRepositionTarget | null {
	return typeof window === 'undefined' ? null : window;
}

function attach(target: ViewportRepositionTarget): void {
	boundTarget = target;
	target.addEventListener('resize', notifySubscribers);
	target.addEventListener('scroll', notifySubscribers, true);
}

function detach(): void {
	if (!boundTarget) return;
	boundTarget.removeEventListener('resize', notifySubscribers);
	boundTarget.removeEventListener('scroll', notifySubscribers, true);
	boundTarget = null;
}

export function observeViewportReposition(
	listener: ViewportRepositionListener,
	target: ViewportRepositionTarget | null = resolveTarget(),
): () => void {
	if (!target) return () => undefined;
	listeners.add(listener);
	if (!boundTarget) attach(target);

	let released = false;
	return () => {
		if (released) return;
		released = true;
		listeners.delete(listener);
		if (listeners.size === 0) detach();
	};
}

export function installedViewportRepositionListenerPairs(): number {
	return boundTarget ? 1 : 0;
}

export function viewportRepositionSubscriberCount(): number {
	return listeners.size;
}
