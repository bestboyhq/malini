import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import {
	activatesClientNavigation,
	AgentChatTabSelection,
	OPTIMISTIC_SELECTION_RELEASE_MS,
	type OptimisticActivationEvent,
} from './ChatTabs.svelte';
import type { SessionId } from '$lib/chat/domain/session';

const alpha: SessionId = 'session-alpha';
const beta: SessionId = 'session-beta';

function click(overrides: Partial<OptimisticActivationEvent> = {}): OptimisticActivationEvent {
	return {
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	};
}

describe('agent chat tab selection optimism', () => {
	it('arms the fresh chat tab and releases it on commit', () => {
		const selection = new AgentChatTabSelection();

		selection.armFresh();
		expect(selection.resolve({ sessionId: alpha, fresh: false })).toEqual({
			sessionId: null,
			fresh: true,
		});

		selection.settle();
		expect(selection.resolve({ sessionId: alpha, fresh: false })).toEqual({
			sessionId: alpha,
			fresh: false,
		});
	});
});

describe('agent chat tab optimistic arming guard', () => {
	it('arms on the primary unmodified click the router turns into a navigation', () => {
		expect(activatesClientNavigation(click())).toBe(true);
	});

	it.each([
		['an already handled click', click({ defaultPrevented: true })],
		['a middle click', click({ button: 1 })],
		['a right click', click({ button: 2 })],
		['a command click', click({ metaKey: true })],
		['a control click', click({ ctrlKey: true })],
		['a shift click', click({ shiftKey: true })],
		['an option click', click({ altKey: true })],
	])('never arms on %s, which starts no client-side navigation', (_label, event) => {
		expect(activatesClientNavigation(event)).toBe(false);
	});
});

describe('agent chat tab armed selection release', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('releases an armed fresh tab whose navigation never reports back', () => {
		const selection = new AgentChatTabSelection();
		selection.armFresh();
		expect(selection.resolve({ sessionId: alpha, fresh: false }).fresh).toBe(true);

		vi.advanceTimersByTime(OPTIMISTIC_SELECTION_RELEASE_MS);

		expect(selection.resolve({ sessionId: alpha, fresh: false }).fresh).toBe(false);
	});

	it('keeps a healthy fresh chat switch armed for the whole navigation budget', () => {
		const selection = new AgentChatTabSelection();
		selection.armFresh();

		vi.advanceTimersByTime(OPTIMISTIC_SELECTION_RELEASE_MS - 1);

		expect(selection.resolve({ sessionId: alpha, fresh: false }).fresh).toBe(true);
	});

	it('drops the pending release once the navigation settles', () => {
		const selection = new AgentChatTabSelection();
		selection.armFresh();
		selection.settle();
		selection.armFresh();

		vi.advanceTimersByTime(OPTIMISTIC_SELECTION_RELEASE_MS - 1);

		expect(selection.resolve({ sessionId: beta, fresh: false }).fresh).toBe(true);
		expect(vi.getTimerCount()).toBe(1);
	});

	it('stops its release timer when the tab strip is disposed', () => {
		const selection = new AgentChatTabSelection();
		selection.armFresh();
		selection.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('agent chat tab optimistic close affordances', () => {
	const source = readFileSync(new URL('./ChatTabs.svelte', import.meta.url), 'utf8');
	const template = source.slice(source.lastIndexOf('</script>'));
	const closeButton = (() => {
		const anchor = source.indexOf("'data-testid': 'chat-agent-tab-close'");
		expect(anchor, 'the tab close button must exist').toBeGreaterThan(-1);
		const start = source.lastIndexOf('<BrowserTab', anchor);
		const end = source.indexOf('/>', anchor);
		return source.slice(start, end);
	})();

	it('drives no rendered affordance from the ids it hides', () => {
		expect(
			template,
			'a tab in `closingSessionIds` is not rendered, so binding markup to that set is dead',
		).not.toContain('closingSessionIds');
	});

	it('re-reads the hidden ids only where they hide a tab', () => {
		expect(
			[...source.matchAll(/closingSessionIds\.has\(/gu)],
			'`closingSessionIds` is a hide set; the only reachable read is the `sessions` filter',
		).toHaveLength(1);
	});

	it('styles no disabled state on a close button that is never disabled', () => {
		expect(closeButton).not.toContain('disabled');
	});
});
