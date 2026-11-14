import { describe, expect, it } from 'vitest';

import { inspectorDock } from './inspector-dock.svelte';

function docked(): readonly unknown[] {
	return [inspectorDock.width, inspectorDock.compact];
}

describe('inspector dock', () => {
	it('keeps the newest dock when the one it replaced lets go after it', () => {
		const first = inspectorDock.claim(true);
		first.measure(288);
		const second = inspectorDock.claim(false);
		second.measure(300);
		first.measure(288);
		first.release();
		expect(docked()).toEqual([300, false]);

		second.release();
		expect(docked()).toEqual([null, false]);
	});

	it('docks nothing while the inspector takes no width, and docks again once it shows', () => {
		const dock = inspectorDock.claim(true);
		dock.measure(0);
		expect(inspectorDock.width).toBeNull();

		dock.measure(288);
		expect(inspectorDock.width).toBe(288);
		dock.release();
	});
});
