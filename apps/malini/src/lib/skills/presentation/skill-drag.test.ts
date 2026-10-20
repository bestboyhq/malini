import { describe, expect, it } from 'vitest';
import { edgeScrollStep } from './skill-drag.svelte';

const LIST = { top: 100, bottom: 500 };

describe('edgeScrollStep', () => {
	it('stays still away from the edges', () => {
		expect(edgeScrollStep(LIST, 300)).toBe(0);
		expect(edgeScrollStep(LIST, 160)).toBe(0);
	});

	it('scrolls toward the edge the pointer nears, faster the closer it gets', () => {
		expect(edgeScrollStep(LIST, 480)).toBeGreaterThan(0);
		expect(edgeScrollStep(LIST, 499)).toBeGreaterThan(edgeScrollStep(LIST, 470));
		expect(edgeScrollStep(LIST, 110)).toBeLessThan(0);
		expect(edgeScrollStep(LIST, 40)).toBe(-14);
	});
});
