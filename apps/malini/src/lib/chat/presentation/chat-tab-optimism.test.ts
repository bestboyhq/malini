import { describe, expect, it } from 'vitest';
import { activatesClientNavigation, type OptimisticActivationEvent } from './ChatTabs.svelte';

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
