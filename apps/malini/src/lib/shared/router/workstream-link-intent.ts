export type WorkstreamLinkIntent = Readonly<{
	workstreamId: string;
	sessionId: string | null;
}>;

type WorkstreamLinkIntentListener = (intent: WorkstreamLinkIntent) => void;

const WORKSTREAM_LINK = 'a[href][data-navigation-workstream-id]';
const LINK_ORIGIN = 'http://malini.local';
const INTENT_EVENTS = ['pointerover', 'pointerdown', 'focusin'] as const;

const listeners = new Set<WorkstreamLinkIntentListener>();
let stopListening: (() => void) | null = null;

export function workstreamLinkIntent(target: EventTarget | null): WorkstreamLinkIntent | null {
	const link = workstreamLinkOf(target);
	return link ? intentOf(link) : null;
}

export function onWorkstreamLinkIntent(listener: WorkstreamLinkIntentListener): () => void {
	listeners.add(listener);
	stopListening ??= listenForIntent();
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		stopListening?.();
		stopListening = null;
	};
}

function listenForIntent(): () => void {
	if (typeof document === 'undefined') return () => undefined;
	let hovered: Element | null = null;
	const announce = (event: Event): void => {
		const link = workstreamLinkOf(event.target);
		if (event.type === 'pointerover') {
			if (link === hovered) return;
			hovered = link;
		}
		const intent = link ? intentOf(link) : null;
		if (!intent) return;
		for (const listener of [...listeners]) listener(intent);
	};
	for (const type of INTENT_EVENTS) {
		document.addEventListener(type, announce, { passive: true, capture: true });
	}
	return () => {
		for (const type of INTENT_EVENTS) {
			document.removeEventListener(type, announce, { capture: true });
		}
	};
}

function workstreamLinkOf(target: EventTarget | null): Element | null {
	return target instanceof Element ? target.closest(WORKSTREAM_LINK) : null;
}

function intentOf(link: Element): WorkstreamLinkIntent | null {
	const workstreamId = link.getAttribute('data-navigation-workstream-id');
	const href = link.getAttribute('href');
	if (!workstreamId || !href) return null;
	return {
		workstreamId,
		sessionId: new URL(href, LINK_ORIGIN).searchParams.get('agent'),
	};
}
