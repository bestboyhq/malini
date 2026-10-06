import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it, vi, type Mock } from 'vitest';

import type { GutterChangeTotals } from './inspector-gutter-row';
import { inspectorGutter, type InspectorGutterSource } from './inspector-gutter.store.svelte';
import { INSPECTOR_MIN_WIDTH } from './inspector-min-width';
import {
	REPOSITORY_CHANGES_PANEL_ID,
	REPOSITORY_FILES_PANEL_ID,
} from './inspector-panel-preferences';

function panel(id: string, label = id): ExtensionPanelRegistration {
	return {
		id,
		label,
		icon: `${id}-icon`,
		component: { mount: async () => ({ dispose: () => undefined }) },
	};
}

const changes = panel(REPOSITORY_CHANGES_PANEL_ID, 'Changes');
const files = panel(REPOSITORY_FILES_PANEL_ID, 'Files');

type InspectorState = {
	workstreamId: string;
	workstreamName: string | null;
	panels: readonly ExtensionPanelRegistration[];
	hiddenPanelIds: readonly string[];
	changeTotals: GutterChangeTotals | null;
	interactive: boolean;
	openPanel: Mock<(panelId: string) => void>;
};

function inspector(overrides: Partial<InspectorState> = {}): {
	state: InspectorState;
	source: InspectorGutterSource;
} {
	const state: InspectorState = {
		workstreamId: 'workstream-1',
		workstreamName: 'Stage center',
		panels: [files, changes],
		hiddenPanelIds: [],
		changeTotals: null,
		interactive: true,
		openPanel: vi.fn(),
		...overrides,
	};
	return {
		state,
		source: {
			workstreamId: () => state.workstreamId,
			workstreamName: () => state.workstreamName,
			panels: () => state.panels,
			hiddenPanelIds: () => state.hiddenPanelIds,
			changeTotals: () => state.changeTotals,
			interactive: () => state.interactive,
			openPanel: (panelId: string) => state.openPanel(panelId),
		},
	};
}

describe('inspector gutter source', () => {
	it('answers nothing while no inspector is connected', () => {
		const { source } = inspector();
		inspectorGutter.connect(source)();

		expect(inspectorGutter.rowsFor('workstream-1')).toEqual([]);
		expect(inspectorGutter.workstreamNameFor('workstream-1')).toBeNull();
		expect(inspectorGutter.isInteractive('workstream-1')).toBe(false);
	});

	it('projects the connected panels through gutterRows, files row first', () => {
		const { source } = inspector({ panels: [changes, files] });
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.rowsFor('workstream-1').map(({ panelId }) => panelId)).toEqual([
			REPOSITORY_FILES_PANEL_ID,
			REPOSITORY_CHANGES_PANEL_ID,
		]);
		expect(inspectorGutter.workstreamNameFor('workstream-1')).toBe('Stage center');
		expect(inspectorGutter.isInteractive('workstream-1')).toBe(true);

		disconnect();
	});

	it('reads the inspector live rather than a copy taken when it connected', () => {
		const { state, source } = inspector({ panels: [] });
		const disconnect = inspectorGutter.connect(source);
		expect(inspectorGutter.rowsFor('workstream-1')).toEqual([]);

		state.panels = [files, changes];
		expect(inspectorGutter.rowsFor('workstream-1')).toHaveLength(2);

		state.workstreamName = 'Golden Circuit';
		expect(inspectorGutter.workstreamNameFor('workstream-1')).toBe('Golden Circuit');

		state.interactive = false;
		expect(inspectorGutter.isInteractive('workstream-1')).toBe(false);

		disconnect();
	});

	it('keeps an unread worktree distinct from a clean one on the files row', () => {
		const { state, source } = inspector();
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.rowsFor('workstream-1')[0]?.changeTotals).toBeNull();

		state.changeTotals = { additions: 0, deletions: 0 };
		expect(inspectorGutter.rowsFor('workstream-1')[0]?.changeTotals).toEqual({
			additions: 0,
			deletions: 0,
		});

		disconnect();
	});

	it('marks a panel that is not open as closed, and still lists it', () => {
		const { state, source } = inspector({ hiddenPanelIds: [REPOSITORY_CHANGES_PANEL_ID] });
		const disconnect = inspectorGutter.connect(source);

		expect(
			inspectorGutter.rowsFor('workstream-1').map(({ panelId, closed }) => [panelId, closed]),
		).toEqual([
			[REPOSITORY_FILES_PANEL_ID, false],
			[REPOSITORY_CHANGES_PANEL_ID, true],
		]);

		state.hiddenPanelIds = [];
		expect(inspectorGutter.rowsFor('workstream-1').every(({ closed }) => !closed)).toBe(true);

		disconnect();
	});

	it('answers only the workstream the connected inspector is presenting', () => {
		const { state, source } = inspector();
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.rowsFor('workstream-2')).toEqual([]);
		expect(inspectorGutter.workstreamNameFor('workstream-2')).toBeNull();

		state.workstreamId = 'workstream-2';

		expect(inspectorGutter.rowsFor('workstream-1')).toEqual([]);
		expect(inspectorGutter.rowsFor('workstream-2')).toHaveLength(2);

		disconnect();
	});

	it('lets a replacement inspector take over without the old one clearing it', () => {
		const outgoing = inspector({ workstreamName: 'Outgoing' });
		const incoming = inspector({ workstreamName: 'Incoming' });
		const disconnectOutgoing = inspectorGutter.connect(outgoing.source);
		const disconnectIncoming = inspectorGutter.connect(incoming.source);

		disconnectOutgoing();

		expect(inspectorGutter.workstreamNameFor('workstream-1')).toBe('Incoming');
		expect(inspectorGutter.rowsFor('workstream-1')).toHaveLength(2);

		disconnectIncoming();
		expect(inspectorGutter.rowsFor('workstream-1')).toEqual([]);
	});

	it('opens a panel through the inspector, which is what also opens the drawer', () => {
		const { state, source } = inspector();
		const disconnect = inspectorGutter.connect(source);

		inspectorGutter.openPanel('workstream-1', REPOSITORY_FILES_PANEL_ID);
		expect(state.openPanel).toHaveBeenCalledWith(REPOSITORY_FILES_PANEL_ID);

		inspectorGutter.openPanel('workstream-2', REPOSITORY_FILES_PANEL_ID);
		expect(state.openPanel).toHaveBeenCalledTimes(1);

		disconnect();
	});

	it('holds the widest open tab as the floor, whichever tab is selected', () => {
		const wide = panel('malini.repository.file:src/a.ts', 'a.ts');
		const { state, source } = inspector({ panels: [files, { ...wide, minWidth: 520 }] });
		const disconnect = inspectorGutter.connect(source);

		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(520);

		state.hiddenPanelIds = [wide.id];
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(INSPECTOR_MIN_WIDTH);

		disconnect();
		expect(inspectorGutter.minWidthFor('workstream-1')).toBe(INSPECTOR_MIN_WIDTH);
	});
});
