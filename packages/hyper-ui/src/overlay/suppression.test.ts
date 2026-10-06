import { describe, expect, it } from 'vitest';

import { OverlaySuppressionRegistry, rectsOverlap, type SuppressionRect } from './suppression';

const hole: SuppressionRect = { x: 400, y: 100, width: 600, height: 500 };

describe('blocking suppression', () => {
	it('suppresses while anything holds it', () => {
		const registry = new OverlaySuppressionRegistry();
		expect(registry.isSuppressed(hole)).toBe(false);
		const release = registry.suppress();
		expect(registry.isSuppressed(hole)).toBe(true);
		release();
		expect(registry.isSuppressed(hole)).toBe(false);
	});

	it('stays suppressed while an outer overlay is still open', () => {
		const registry = new OverlaySuppressionRegistry();
		const outer = registry.suppress();
		const inner = registry.suppress();
		expect(registry.blockingDepth).toBe(2);
		inner();
		expect(registry.isSuppressed(hole)).toBe(true);
		outer();
		expect(registry.isSuppressed(hole)).toBe(false);
	});

	it('ignores a release that runs twice', () => {
		const registry = new OverlaySuppressionRegistry();
		const outer = registry.suppress();
		const inner = registry.suppress();
		inner();
		inner();
		expect(registry.blockingDepth).toBe(1);
		expect(registry.isSuppressed(hole)).toBe(true);
		outer();
		expect(registry.isSuppressed(hole)).toBe(false);
	});

	it('never counts below zero when a release outlives its suppress', () => {
		const registry = new OverlaySuppressionRegistry();
		registry.release();
		registry.release();
		expect(registry.blockingDepth).toBe(0);
		const release = registry.suppress();
		expect(registry.isSuppressed(hole)).toBe(true);
		release();
		expect(registry.isSuppressed(hole)).toBe(false);
	});
});

describe('anchored suppression', () => {
	it('suppresses only while the overlay overlaps the surface', () => {
		const registry = new OverlaySuppressionRegistry();
		const release = registry.suppress(() => ({ x: 0, y: 0, width: 200, height: 200 }));
		expect(registry.isSuppressed(hole)).toBe(false);
		release();

		registry.suppress(() => ({ x: 380, y: 90, width: 120, height: 120 }));
		expect(registry.isSuppressed(hole)).toBe(true);
	});

	it('treats an unmeasurable overlay as not overlapping', () => {
		const registry = new OverlaySuppressionRegistry();
		registry.suppress(() => null);
		expect(registry.isSuppressed(hole)).toBe(false);
	});

	it('decides nothing without a surface rect', () => {
		const registry = new OverlaySuppressionRegistry();
		registry.suppress(() => ({ x: 0, y: 0, width: 4000, height: 4000 }));
		expect(registry.isSuppressed(null)).toBe(false);
	});

	it('still suppresses a blocking overlay without a surface rect', () => {
		const registry = new OverlaySuppressionRegistry();
		registry.suppress();
		expect(registry.isSuppressed(null)).toBe(true);
	});

	it('drops its measure on release', () => {
		const registry = new OverlaySuppressionRegistry();
		const release = registry.suppress(() => hole);
		expect(registry.anchoredCount).toBe(1);
		release();
		release();
		expect(registry.anchoredCount).toBe(0);
		expect(registry.isSuppressed(hole)).toBe(false);
	});
});

describe('subscribers', () => {
	it('is notified on every change and stops on unsubscribe', () => {
		const registry = new OverlaySuppressionRegistry();
		let notifications = 0;
		const unsubscribe = registry.subscribe(() => {
			notifications += 1;
		});
		const release = registry.suppress();
		release();
		expect(notifications).toBe(2);
		unsubscribe();
		registry.suppress();
		expect(notifications).toBe(2);
	});
});

describe('rectsOverlap', () => {
	it('is false for touching edges', () => {
		expect(
			rectsOverlap(
				{ x: 0, y: 0, width: 400, height: 100 },
				{ x: 400, y: 0, width: 10, height: 10 },
			),
		).toBe(false);
	});

	it('is true for containment in either direction', () => {
		const outer = { x: 0, y: 0, width: 1000, height: 1000 };
		const inner = { x: 10, y: 10, width: 10, height: 10 };
		expect(rectsOverlap(outer, inner)).toBe(true);
		expect(rectsOverlap(inner, outer)).toBe(true);
	});
});
