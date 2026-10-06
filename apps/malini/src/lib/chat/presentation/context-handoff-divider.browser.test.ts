import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import ContextHandoffDivider from './chat-message-list/ContextHandoffDivider.svelte';
import chatTimelineRowSource from './chat-message-list/ChatTimelineRow.svelte?raw';

function render(): Readonly<{ host: HTMLElement; stop: () => void }> {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ContextHandoffDivider, { target: host });
	flushSync();
	return {
		host,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
}

function divider(host: HTMLElement): HTMLElement {
	const element = host.querySelector<HTMLElement>('[data-testid="chat-context-handoff"]');
	if (!element) throw new Error('the handoff divider did not render');
	return element;
}

describe('the context handoff divider', () => {
	it('draws a labeled rule rather than a message bubble', () => {
		const { host, stop } = render();

		const row = divider(host);
		expect(row.getAttribute('data-message-kind')).toBe('handoff');
		const rules = [...row.querySelectorAll('[aria-hidden="true"]')];
		expect(rules).toHaveLength(2);
		expect(row.textContent?.trim()).not.toBe('');

		stop();
	});

	it('stays a structural marker: no bubble surface, no failure color', () => {
		const { host, stop } = render();

		const classes = divider(host).className;
		expect(classes).not.toMatch(/\berror\b/u);
		expect(classes).not.toMatch(/\bwarning\b/u);
		expect(classes).not.toMatch(/\brounded-md\b/u);
		expect(classes).toContain('text-fg-tertiary');

		stop();
	});

	it('is the row the timeline draws for a handoff item', () => {
		expect(chatTimelineRowSource).toContain("{:else if item.kind === 'handoff'}");
		expect(chatTimelineRowSource).toContain('<ContextHandoffDivider />');
	});
});
