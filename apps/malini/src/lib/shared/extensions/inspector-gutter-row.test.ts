import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { gutterRows } from './inspector-gutter-row';
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
const linear = panel('example.linear.panel', 'Linear');
const terminal = panel('example.terminal.panel', 'Terminal');

describe('gutterRows', () => {
	it('keeps the presented panel order so the gutter and the tab strip cannot drift', () => {
		const rows = gutterRows({
			panels: [linear, terminal],
			hiddenPanelIds: [],
			changeTotals: null,
		});

		expect(rows.map(({ id }) => id)).toEqual(['example.linear.panel', 'example.terminal.panel']);
		expect(rows.map(({ label }) => label)).toEqual(['Linear', 'Terminal']);
	});

	it('pins the files panel first wherever it sits in the presented order', () => {
		const rows = gutterRows({
			panels: [linear, terminal, files],
			hiddenPanelIds: [],
			changeTotals: null,
		});

		expect(rows.map(({ id }) => id)).toEqual([
			REPOSITORY_FILES_PANEL_ID,
			'example.linear.panel',
			'example.terminal.panel',
		]);
	});

	it('honors a caller-supplied pinned panel id', () => {
		const rows = gutterRows({
			panels: [files, changes],
			hiddenPanelIds: [],
			changeTotals: { additions: 3, deletions: 1 },
			changesPanelId: REPOSITORY_CHANGES_PANEL_ID,
		});

		expect(rows.map(({ id }) => id)).toEqual([
			REPOSITORY_CHANGES_PANEL_ID,
			REPOSITORY_FILES_PANEL_ID,
		]);
		expect(rows[0]).toMatchObject({ changeTotals: { additions: 3, deletions: 1 } });
		expect(rows[1]).toMatchObject({ changeTotals: null });
	});

	it('marks a panel that is not open as closed rather than dropping it', () => {
		const rows = gutterRows({
			panels: [changes, linear, terminal],
			hiddenPanelIds: ['example.linear.panel'],
			changeTotals: null,
		});

		expect(rows.map(({ id }) => id)).toEqual([
			REPOSITORY_CHANGES_PANEL_ID,
			'example.linear.panel',
			'example.terminal.panel',
		]);
		expect(rows.map((row) => row.kind === 'panel' && row.closed)).toEqual([false, true, false]);
	});

	it('keeps the pinned files row listed, and pinned, even when it is closed', () => {
		const rows = gutterRows({
			panels: [files, linear],
			hiddenPanelIds: [REPOSITORY_FILES_PANEL_ID],
			changeTotals: { additions: 9, deletions: 9 },
		});

		expect(rows.map(({ id }) => id)).toEqual([REPOSITORY_FILES_PANEL_ID, 'example.linear.panel']);
		expect(rows[0]).toMatchObject({ closed: true, changeTotals: { additions: 9, deletions: 9 } });
	});

	it('carries the diffstat on the files row and nowhere else', () => {
		const rows = gutterRows({
			panels: [files, linear],
			hiddenPanelIds: [],
			changeTotals: { additions: 1265, deletions: 667 },
		});

		expect(rows[0]).toMatchObject({ changeTotals: { additions: 1265, deletions: 667 } });
		expect(rows[1]).toMatchObject({ changeTotals: null });
	});

	it('keeps an unread worktree distinct from a clean one', () => {
		const unread = gutterRows({
			panels: [files],
			hiddenPanelIds: [],
			changeTotals: null,
		});
		const clean = gutterRows({
			panels: [files],
			hiddenPanelIds: [],
			changeTotals: { additions: 0, deletions: 0 },
		});

		expect(unread[0]).toMatchObject({ changeTotals: null });
		expect(clean[0]).toMatchObject({ changeTotals: { additions: 0, deletions: 0 } });
	});

	it('names the files row Changes, since it opens Files on the changed files', () => {
		const rows = gutterRows({
			panels: [linear, files],
			hiddenPanelIds: [],
			changeTotals: null,
		});

		expect(rows.map(({ label }) => label)).toEqual(['Changes', 'Linear']);
		expect(rows[0]?.icon).toBe('changes');
	});

	it('lists the actions right under the changes row, with their counts', () => {
		const rows = gutterRows({
			panels: [linear, files],
			hiddenPanelIds: [],
			changeTotals: null,
			actions: [
				{ id: 'media', label: 'Media', icon: 'image', count: 4 },
				{ id: 'browser', label: 'Browser', icon: 'browser', count: null },
			],
		});

		expect(rows.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
			`panel:${REPOSITORY_FILES_PANEL_ID}`,
			'action:media',
			'action:browser',
			'panel:example.linear.panel',
		]);
		expect(rows[1]).toMatchObject({ label: 'Media', count: 4 });
		expect(rows[2]).toMatchObject({ label: 'Browser', count: null });
	});
});
