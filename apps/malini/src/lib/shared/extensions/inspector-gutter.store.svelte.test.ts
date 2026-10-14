import { describe, expect, it } from 'vitest';

import { inspectorGutter, type InspectorGutterSource } from './inspector-gutter.store.svelte';
import { INSPECTOR_MIN_WIDTH } from './inspector-min-width';

function inspector(
	workstreamId: string,
	minWidth: number,
): {
	state: { workstreamId: string; minWidth: number; presentedPanelId: string | null };
	source: InspectorGutterSource;
} {
	const state = { workstreamId, minWidth, presentedPanelId: null as string | null };
	return {
		state,
		source: {
			workstreamId: () => state.workstreamId,
			minWidth: () => state.minWidth,
			presentedPanelId: () => state.presentedPanelId,
		},
	};
}

describe('inspector gutter source', () => {
	it('answers the default floor while no inspector is connected', () => {
		inspectorGutter.connect(inspector('workstream-1', 520).source)();

		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(INSPECTOR_MIN_WIDTH);
	});

	it('reads the inspector live, and only for the workstream it is presenting', () => {
		const { state, source } = inspector('workstream-1', 520);
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(520);
		expect(inspectorGutter.minWidthFor('workstream-2')).toBe(INSPECTOR_MIN_WIDTH);

		state.minWidth = 600;
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(600);

		state.workstreamId = 'workstream-2';
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(INSPECTOR_MIN_WIDTH);
		expect(inspectorGutter.minWidthFor('workstream-2')).toBe(600);

		disconnect();
	});

	it('tells the layout which panel the inspector presents, only for its workstream', () => {
		const { state, source } = inspector('workstream-1', 520);
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.presentedPanelFor('workstream-1')).toBeNull();
		state.presentedPanelId = 'malini.browser';
		expect(inspectorGutter.presentedPanelFor('workstream-1')).toBe('malini.browser');
		expect(inspectorGutter.presentedPanelFor('workstream-2')).toBeNull();

		disconnect();
		expect(inspectorGutter.presentedPanelFor('workstream-1')).toBeNull();
	});

	it('lets a replacement inspector take over without the old one clearing it', () => {
		const disconnectOutgoing = inspectorGutter.connect(inspector('workstream-1', 400).source);
		const disconnectIncoming = inspectorGutter.connect(inspector('workstream-1', 520).source);

		disconnectOutgoing();
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(520);

		disconnectIncoming();
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(INSPECTOR_MIN_WIDTH);
	});
});
