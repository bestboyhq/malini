import { describe, expect, it } from 'vitest';

import { inspectorDock } from './inspector-dock.svelte';

function docked(): readonly unknown[] {
	return [inspectorDock.width, inspectorDock.compact, inspectorDock.empty];
}

describe('inspector dock', () => {
	it('keeps the newest dock when the one it replaced lets go after it', () => {
		const folded = inspectorDock.claim(true, false);
		folded.measure(288);
		const empty = inspectorDock.claim(true, true);
		empty.measure(300);
		folded.measure(288);
		folded.release();
		expect(docked()).toEqual([300, true, true]);

		empty.release();
		expect(docked()).toEqual([null, false, false]);
	});
});
