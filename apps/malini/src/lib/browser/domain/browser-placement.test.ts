import { describe, expect, it } from 'vitest';

import { browserPlacementFor, sameBrowserPlacement } from './browser-placement';

const VIEWPORT = { left: 10.4, top: 20.6, right: 310.5, bottom: 420.2 };

describe('placing the native browser view', () => {
	it('shows the page on whole pixels that cover the viewport edge to edge', () => {
		expect(browserPlacementFor(VIEWPORT, true, 'none')).toEqual({
			kind: 'shown',
			bounds: { x: 10, y: 21, width: 301, height: 399 },
		});
	});

	it('tells an overlay over part of the page from one over the whole window', () => {
		expect(browserPlacementFor(VIEWPORT, true, 'overlapped')).toEqual({ kind: 'overlapped' });
		expect(browserPlacementFor(VIEWPORT, true, 'covered')).toEqual({ kind: 'covered' });
	});

	it('hides the view when nothing is open or the viewport has no area', () => {
		expect(browserPlacementFor(VIEWPORT, false, 'none')).toEqual({ kind: 'hidden' });
		expect(browserPlacementFor({ left: 0, top: 0, right: 0, bottom: 0 }, true, 'covered')).toEqual({
			kind: 'hidden',
		});
	});

	it('treats the same bounds as the same placement and a move as a new one', () => {
		const shown = browserPlacementFor(VIEWPORT, true, 'none');
		expect(sameBrowserPlacement(shown, browserPlacementFor(VIEWPORT, true, 'none'))).toBe(true);
		expect(
			sameBrowserPlacement(shown, browserPlacementFor({ ...VIEWPORT, left: 12 }, true, 'none')),
		).toBe(false);
		expect(sameBrowserPlacement({ kind: 'hidden' }, shown)).toBe(false);
		expect(sameBrowserPlacement({ kind: 'covered' }, { kind: 'covered' })).toBe(true);
		expect(sameBrowserPlacement({ kind: 'covered' }, { kind: 'overlapped' })).toBe(false);
	});
});
