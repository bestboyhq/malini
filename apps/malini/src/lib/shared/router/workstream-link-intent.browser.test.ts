import { afterEach, describe, expect, it, vi } from 'vitest';

import { onWorkstreamLinkIntent, type WorkstreamLinkIntent } from './workstream-link-intent';

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('workstream link intent', () => {
	it('tells every subscriber which workstream the pointer is heading to, from one listener', () => {
		const listen = vi.spyOn(document, 'addEventListener');
		const link = workstreamLink('workstream-b', '/workstreams/workstream-b?agent=session-7');
		const chat: WorkstreamLinkIntent[] = [];
		const inspector: WorkstreamLinkIntent[] = [];
		const stopChat = onWorkstreamLinkIntent((intent) => chat.push(intent));
		const stopInspector = onWorkstreamLinkIntent((intent) => inspector.push(intent));

		link.dispatchEvent(new Event('pointerover', { bubbles: true }));

		const expected = { workstreamId: 'workstream-b', sessionId: 'session-7' };
		expect(chat).toEqual([expected]);
		expect(inspector).toEqual([expected]);
		expect(listen.mock.calls.map(([type]) => type)).toEqual([
			'pointerover',
			'pointerdown',
			'focusin',
		]);
		stopChat();
		stopInspector();
	});

	it('announces a hover once per entry into a row, not for every element inside it', () => {
		const link = workstreamLink('workstream-d', '/workstreams/workstream-d');
		const label = document.createElement('span');
		const badge = document.createElement('span');
		link.append(label, badge);
		const outside = document.createElement('p');
		document.body.append(outside);
		const seen: string[] = [];
		const stop = onWorkstreamLinkIntent((intent) => seen.push(intent.workstreamId));

		for (const target of [link, label, badge, label]) {
			target.dispatchEvent(new Event('pointerover', { bubbles: true }));
		}
		expect(seen).toEqual(['workstream-d']);

		outside.dispatchEvent(new Event('pointerover', { bubbles: true }));
		badge.dispatchEvent(new Event('pointerover', { bubbles: true }));
		expect(seen).toEqual(['workstream-d', 'workstream-d']);
		stop();
	});

	it('stops listening once nobody is interested', () => {
		const unlisten = vi.spyOn(document, 'removeEventListener');
		const link = workstreamLink('workstream-c', '/workstreams/workstream-c');
		const seen: WorkstreamLinkIntent[] = [];
		const stop = onWorkstreamLinkIntent((intent) => seen.push(intent));
		stop();

		link.dispatchEvent(new Event('pointerdown', { bubbles: true }));

		expect(seen).toEqual([]);
		expect(unlisten.mock.calls.map(([type]) => type)).toEqual([
			'pointerover',
			'pointerdown',
			'focusin',
		]);
	});
});

function workstreamLink(workstreamId: string, href: string): HTMLAnchorElement {
	const link = document.createElement('a');
	link.href = href;
	link.setAttribute('href', href);
	link.dataset.navigationWorkstreamId = workstreamId;
	link.textContent = workstreamId;
	document.body.append(link);
	return link;
}
