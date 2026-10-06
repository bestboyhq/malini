import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	REPOSITORY_CHANGES_PANEL_ID,
	REPOSITORY_FILES_PANEL_ID,
	moveInspectorPanel,
	placeInspectorPanel,
	projectInspectorPanelPresentation,
	reconcileInspectorPanelPreferences,
	selectInspectorPanel,
	setInspectorPanelVisible,
	visibleInspectorPanels,
	type InspectorPanelPreferences,
} from './inspector-panel-preferences';
import {
	loadInspectorPanelPreferences,
	saveInspectorPanelPreferences,
} from './inspector-panel-preferences.store';

const context: ExtensionPanelContext = {
	workstream: null,
	settings: {},
	executeCommand: () => Promise.reject(new Error('These preference tests execute no commands')),
};

function panel(
	id: string,
	options: { order?: number; defaultVisible?: boolean } = {},
): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: `${id}-icon`,
		...options,
		component: {
			mount: async (_target, receivedContext) => {
				expect(receivedContext).toBe(context);
				return { dispose: () => undefined };
			},
		},
	};
}

function memoryStorage(seed: Record<string, string> = {}) {
	const values = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe('extension inspector panel preferences', () => {
	it('uses manifest order and honors panels that are hidden by default', () => {
		const panels = [
			panel('third', { order: 30 }),
			panel('hidden', { order: 20, defaultVisible: false }),
			panel('first', { order: 10 }),
		];
		const preferences = loadInspectorPanelPreferences('workstream-1', panels, memoryStorage());

		expect(preferences.order).toEqual(['first', 'hidden', 'third']);
		expect(preferences.hidden).toEqual(['hidden']);
		expect(preferences.activeId).toBe('first');
		expect(visibleInspectorPanels(panels, preferences).map(({ id }) => id)).toEqual([
			'first',
			'third',
		]);
	});

	it('opens an unarranged workstream on Files, whatever else registered first', () => {
		const panels = [
			panel('example.overview.panel', { order: 5 }),
			panel(REPOSITORY_CHANGES_PANEL_ID, { order: 30 }),
			panel(REPOSITORY_FILES_PANEL_ID, { order: 20 }),
		];

		expect(loadInspectorPanelPreferences('workstream-1', panels, memoryStorage()).activeId).toBe(
			REPOSITORY_FILES_PANEL_ID,
		);
		expect(
			loadInspectorPanelPreferences(
				'workstream-2',
				[panel('example.overview.panel', { order: 5 }), panel(REPOSITORY_CHANGES_PANEL_ID)],
				memoryStorage(),
			).activeId,
		).toBe('example.overview.panel');
		expect(
			loadInspectorPanelPreferences(
				'workstream-3',
				[
					panel('example.overview.panel', { order: 5 }),
					panel(REPOSITORY_FILES_PANEL_ID, { order: 20, defaultVisible: false }),
				],
				memoryStorage(),
			).activeId,
		).toBe('example.overview.panel');
	});

	it('preserves user order while removing stale registrations and adding new ones', () => {
		const preferences = reconcileInspectorPanelPreferences(
			[
				panel('alpha', { order: 10 }),
				panel('new-hidden', { defaultVisible: false }),
				panel('beta'),
			],
			{
				version: 2,
				order: ['removed', 'beta', 'alpha'],
				hidden: ['removed'],
				activeId: 'removed',
			},
		);

		expect(preferences).toEqual({
			version: 2,
			order: ['beta', 'alpha', 'new-hidden'],
			hidden: ['new-hidden'],
			activeId: 'beta',
		});
	});

	it('projects one active live tab before stale workstream preferences are committed', () => {
		const presentation = projectInspectorPanelPresentation(
			[
				panel('example.terminal.panel', { order: 10 }),
				panel('malini.repository.files-panel', { order: 20 }),
			],
			{
				version: 2,
				order: ['example.workstream-setup.panel', 'example.terminal.panel'],
				hidden: [],
				activeId: 'example.workstream-setup.panel',
			},
		);

		expect(presentation.preferences.activeId).toBe('example.terminal.panel');
		expect(presentation.visiblePanels.map(({ id }) => id)).toEqual([
			'example.terminal.panel',
			'malini.repository.files-panel',
		]);
		expect(presentation.activePanel?.id).toBe('example.terminal.panel');
		expect(
			presentation.visiblePanels.filter((panel) => panel.id === presentation.preferences.activeId),
		).toHaveLength(1);
	});

	it('selects, hides, and reorders by contribution id without panel-name knowledge', () => {
		const initial: InspectorPanelPreferences = {
			version: 2,
			order: ['one', 'two', 'three'],
			hidden: [],
			activeId: 'one',
		};
		const selected = selectInspectorPanel(initial, 'two');
		const hidden = setInspectorPanelVisible(selected, 'two', false);
		const moved = moveInspectorPanel(hidden, 'three', -1);

		expect(hidden.activeId).toBe('one');
		expect(hidden.hidden).toEqual(['two']);
		expect(moved.order).toEqual(['one', 'three', 'two']);
		expect(setInspectorPanelVisible(hidden, 'one', false).activeId).toBe('three');
	});

	it('drops a panel at the index a drag lands on, clamped to the ends', () => {
		const preferences = {
			version: 2 as const,
			order: ['a', 'b', 'c', 'd'],
			hidden: [],
			activeId: 'a',
		};
		expect(placeInspectorPanel(preferences, 'd', 0).order).toEqual(['d', 'a', 'b', 'c']);
		expect(placeInspectorPanel(preferences, 'a', 2).order).toEqual(['b', 'c', 'a', 'd']);
		expect(placeInspectorPanel(preferences, 'a', 99).order).toEqual(['b', 'c', 'd', 'a']);
		expect(placeInspectorPanel(preferences, 'c', -5).order).toEqual(['c', 'a', 'b', 'd']);
		expect(placeInspectorPanel(preferences, 'b', 1)).toBe(preferences);
		expect(placeInspectorPanel(preferences, 'zzz', 0)).toBe(preferences);
	});

	it('does not allow the final visible panel to be hidden', () => {
		const onlyOneVisible = {
			version: 2 as const,
			order: ['one', 'two'],
			hidden: ['two'],
			activeId: 'one',
		};
		expect(setInspectorPanelVisible(onlyOneVisible, 'one', false)).toBe(onlyOneVisible);
	});

	it('repairs corrupt persisted state instead of making the inspector unreachable', () => {
		const storage = memoryStorage({
			[`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-2`]: '{broken',
		});
		expect(loadInspectorPanelPreferences('workstream-2', [panel('safe')], storage)).toEqual({
			version: 2,
			order: ['safe'],
			hidden: [],
			activeId: 'safe',
		});
	});

	it('keeps a saved Changes tab selected now that Changes is its own panel again', () => {
		const storage = memoryStorage({
			[`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-changes`]: JSON.stringify({
				version: 2,
				order: ['example.terminal.panel', REPOSITORY_CHANGES_PANEL_ID, REPOSITORY_FILES_PANEL_ID],
				hidden: [REPOSITORY_FILES_PANEL_ID],
				activeId: REPOSITORY_CHANGES_PANEL_ID,
			}),
		});
		const preferences = loadInspectorPanelPreferences(
			'workstream-changes',
			[
				panel(REPOSITORY_CHANGES_PANEL_ID),
				panel(REPOSITORY_FILES_PANEL_ID),
				panel('example.terminal.panel'),
			],
			storage,
		);

		expect(preferences.order).toEqual([
			'example.terminal.panel',
			REPOSITORY_CHANGES_PANEL_ID,
			REPOSITORY_FILES_PANEL_ID,
		]);
		expect(preferences.hidden).toEqual([REPOSITORY_FILES_PANEL_ID]);
		expect(preferences.activeId).toBe(REPOSITORY_CHANGES_PANEL_ID);
	});

	describe('v1 key migration', () => {
		const panels = [
			panel('files', { order: 10 }),
			panel('terminal', { order: 20, defaultVisible: false }),
			panel('preview', { order: 30, defaultVisible: false }),
		];

		function legacyEntry(value: Record<string, unknown>) {
			return {
				[`${LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-legacy`]: JSON.stringify({
					version: 1,
					...value,
				}),
			};
		}

		it('drops a v1 entry that only records the arrangement the old shell wrote unasked', () => {
			const storage = memoryStorage(
				legacyEntry({
					order: ['files', 'terminal', 'preview'],
					hidden: [],
					activeId: 'files',
				}),
			);

			expect(loadInspectorPanelPreferences('workstream-legacy', panels, storage)).toEqual({
				version: 2,
				order: ['files', 'terminal', 'preview'],
				hidden: ['terminal', 'preview'],
				activeId: 'files',
			});
		});

		it('keeps a v1 entry the user actually shaped', () => {
			const storage = memoryStorage(
				legacyEntry({
					order: ['terminal', 'files', 'preview'],
					hidden: ['preview'],
					activeId: 'terminal',
				}),
			);

			expect(loadInspectorPanelPreferences('workstream-legacy', panels, storage)).toEqual({
				version: 2,
				order: ['terminal', 'files', 'preview'],
				hidden: ['preview'],
				activeId: 'terminal',
			});
		});

		it('never writes back to the v1 key and prefers v2 once a choice is recorded', () => {
			const storage = memoryStorage(
				legacyEntry({ order: ['terminal', 'files', 'preview'], hidden: [], activeId: 'terminal' }),
			);
			const legacyBefore = storage.getItem(
				`${LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-legacy`,
			);

			saveInspectorPanelPreferences(
				'workstream-legacy',
				{ version: 2, order: ['files', 'terminal', 'preview'], hidden: [], activeId: 'preview' },
				storage,
			);

			expect(
				storage.getItem(`${LEGACY_INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-legacy`),
			).toBe(legacyBefore);
			expect(
				storage.getItem(`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}workstream-legacy`),
			).not.toBe(null);
			expect(loadInspectorPanelPreferences('workstream-legacy', panels, storage).activeId).toBe(
				'preview',
			);
		});
	});
});
