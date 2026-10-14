import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import InspectorSplit from './InspectorSplit.svelte';

const pane = createRawSnippet(() => ({ render: () => '<div></div>' }));
const mounted: Array<Record<string, unknown>> = [];

afterEach(() => {
	while (mounted.length > 0) {
		const component = mounted.pop();
		if (component) unmount(component);
	}
	document.body.replaceChildren();
});

function renderSplit(): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	mounted.push(
		mount(InspectorSplit, {
			target: host,
			props: { workstreamId: 'workstream-resize', primary: pane, secondary: pane },
		}),
	);
	flushSync();
	const handle = host.querySelector<HTMLElement>('[role="separator"]');
	if (!handle) throw new Error('the inspector split rendered no resize handle');
	Object.assign(handle, {
		setPointerCapture: () => undefined,
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
	});
	return handle;
}

function pointer(handle: HTMLElement, type: string, clientX: number, buttons: number): void {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, buttons });
	Object.defineProperties(event, {
		pointerId: { value: 1 },
		pointerType: { value: 'mouse' },
	});
	handle.dispatchEvent(event);
	flushSync();
}

describe('the inspector resize handle', () => {
	it('lets go once the mouse moves with no button held, even when the release was never seen', () => {
		const handle = renderSplit();
		const start = Number(handle.getAttribute('aria-valuenow'));

		pointer(handle, 'pointerdown', 600, 1);
		pointer(handle, 'pointermove', 640, 1);
		expect(Number(handle.getAttribute('aria-valuenow'))).toBe(start + 40);

		pointer(handle, 'pointermove', 700, 0);
		pointer(handle, 'pointermove', 760, 0);
		expect(Number(handle.getAttribute('aria-valuenow'))).toBe(start + 40);
	});
});
