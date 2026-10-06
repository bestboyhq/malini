import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scrollable = readFileSync(new URL('./ScrollableDiv.svelte', import.meta.url), 'utf8');

describe('ScrollableDiv paint contract', () => {
	it('does not introduce WebKit mask or accelerated-compositing paint holes', () => {
		expect(scrollable).not.toMatch(/(?:-webkit-)?mask(?:-image)?\s*:/u);
		expect(scrollable).not.toMatch(/backdrop-filter\s*:/u);
		expect(scrollable).not.toMatch(/mix-blend-mode\s*:/u);
		expect(scrollable).not.toMatch(/will-change\s*:/u);
		expect(scrollable).not.toMatch(/transform\s*:/u);
	});

	it('defers observer-driven measurements outside the ResizeObserver delivery cycle', () => {
		expect(scrollable).toContain('new ResizeObserver(scheduleScrollbarMeasurement)');
		expect(scrollable).toContain('requestAnimationFrame(() => {');
		expect(scrollable).toContain('cancelAnimationFrame(measurementFrame)');
		expect(scrollable).not.toContain('new ResizeObserver(updateScrollbars)');
	});

	it('derives the reserved gutter from props alone, never from measured overflow', () => {
		const derivations = [
			...scrollable.matchAll(/const reserves\w+Gutter = \$derived\((?<expr>[^)]*)\)/gu),
		].map((match) => match.groups?.expr ?? '');

		expect(derivations).toHaveLength(2);
		for (const expression of derivations) {
			expect(expression).toContain('reserveGutter');
			expect(expression).not.toMatch(/hasVerticalScroll|hasHorizontalScroll/u);
		}
	});
});
