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

	it('slides with the gutter it docks onto, and stays in place once the gutter lets go', () => {
		const dock = inspectorDock.claim();
		dock.measure(288);
		let away = { offset: 300, gone: true };
		const letGo = inspectorDock.slideWith(() => away);
		expect(inspectorDock.width).toBe(288);
		expect(inspectorDock.away).toEqual({ offset: 300, gone: true });

		away = { offset: 120, gone: false };
		expect(inspectorDock.away).toEqual({ offset: 120, gone: false });
		const replaced = inspectorDock.slideWith(() => ({ offset: 40, gone: false }));
		letGo();
		expect(inspectorDock.away).toEqual({ offset: 40, gone: false });

		replaced();
		expect(inspectorDock.away).toEqual({ offset: 0, gone: false });
		dock.release();
	});
});
