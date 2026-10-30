import { describe, expect, it } from 'vitest';
import { steppedVariant, variantSwitcher } from './variant-pages';

const older = [
	{ id: 'A', name: 'Calm', src: '.context/hero/a.html' },
	{ id: 'B', name: 'Bold', src: '.context/hero/b.html' },
];
const newer = [
	{ id: 'A', name: 'Line', src: '.context/badges/a.html' },
	{ id: 'B', name: 'Hairline', src: '.context/badges/b.html' },
	{ id: 'C', name: 'Ticks', src: '.context/badges/c.png' },
];

describe('variant switcher', () => {
	it('shows the variants of the newest report that offers the page, whatever its query', () => {
		const switcher = variantSwitcher('malini-worktree://ws-1/.context/badges/b.html?v=4', 'WS-1', [
			older,
			newer,
			[{ id: 'A', name: 'Lone', src: '.context/lone.html' }],
		]);
		expect(switcher?.current).toBe(1);
		expect(switcher?.pages.map(({ id, name, url }) => `${id} ${name} ${url}`)).toEqual([
			'A Line malini-worktree://ws-1/.context/badges/a.html',
			'B Hairline malini-worktree://ws-1/.context/badges/b.html',
			'C Ticks malini-worktree://ws-1/.context/badges/c.png',
		]);
		expect(
			variantSwitcher('malini-worktree://ws-1/.context/hero/a.html', 'ws-1', [older, newer])
				?.pages[1]?.name,
		).toBe('Bold');
	});

	it('tells variants of one page apart by their fragment', () => {
		const anchors = [
			{ id: 'A', name: 'Card', src: '.context/nudge.html#a' },
			{ id: 'B', name: 'Flame', src: '.context/nudge.html#b' },
		];
		expect(
			variantSwitcher('malini-worktree://ws-1/.context/nudge.html#b', 'ws-1', [anchors])?.current,
		).toBe(1);
		expect(
			variantSwitcher('malini-worktree://ws-1/.context/nudge.html', 'ws-1', [anchors]),
		).toBeNull();
	});

	it('stays away from pages no report offers and from the web', () => {
		expect(
			variantSwitcher('malini-worktree://ws-1/.context/other.html', 'ws-1', [newer]),
		).toBeNull();
		expect(
			variantSwitcher('malini-worktree://ws-2/.context/badges/a.html', 'ws-1', [newer]),
		).toBeNull();
		expect(
			variantSwitcher('http://localhost:5173/.context/badges/a.html', 'ws-1', [newer]),
		).toBeNull();
	});

	it('steps around the ends', () => {
		const switcher = variantSwitcher('malini-worktree://ws-1/.context/badges/a.html', 'ws-1', [
			newer,
		]);
		if (!switcher) throw new Error('the page is a variant');
		expect(steppedVariant(switcher, -1)?.id).toBe('C');
		expect(steppedVariant(switcher, 1)?.id).toBe('B');
	});
});
