import { describe, expect, it } from 'vitest';
import { computeOverflowTabs } from './overflow-tabs';

const items = ['one', 'two', 'three', 'four', 'five'];
const widths = Object.fromEntries(items.map((item) => [item, 80]));

describe('agent chat overflow tabs', () => {
	it('keeps the active tab visible when it falls outside the leading slice', () => {
		const result = computeOverflowTabs({
			items,
			getId: (item) => item,
			pinnedId: 'five',
			measurements: {
				availableWidth: 350,
				reservedWidth: 50,
				overflowWidth: 40,
				itemWidths: widths,
				gap: 4,
			},
		});
		expect(result.visible).toEqual(['one', 'two', 'five']);
		expect(result.hidden).toEqual(['three', 'four']);
	});

	it('shrinks tabs down to the minimum width before hiding any', () => {
		const measure = (minItemWidth: number) =>
			computeOverflowTabs({
				items,
				getId: (item) => item,
				pinnedId: null,
				measurements: {
					availableWidth: 330,
					reservedWidth: 50,
					overflowWidth: 40,
					itemWidths: { ...widths, one: 30 },
					minItemWidth,
					gap: 4,
				},
			});
		expect(measure(50).hidden).toEqual([]);
		expect(measure(60).hidden).toEqual(['five']);
	});

	it('shows every tab when measurements fit', () => {
		const result = computeOverflowTabs({
			items,
			getId: (item) => item,
			pinnedId: 'three',
			measurements: {
				availableWidth: 500,
				reservedWidth: 50,
				overflowWidth: 40,
				itemWidths: widths,
				gap: 4,
			},
		});
		expect(result.visible).toEqual(items);
		expect(result.hidden).toEqual([]);
	});
});
