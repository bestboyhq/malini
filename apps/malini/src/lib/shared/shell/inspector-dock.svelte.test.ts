import { describe, expect, it } from 'vitest';

import { inspectorDock } from './inspector-dock.svelte';

describe('inspector dock', () => {
	it('keeps the newest dock when the one it replaced lets go after it', () => {
		const first = inspectorDock.claim();
		first.measure(288);
		const second = inspectorDock.claim();
		second.measure(300);
		first.measure(288);
		first.release();
		expect(inspectorDock.width).toBe(300);

		second.release();
		expect(inspectorDock.width).toBeNull();
	});
});
