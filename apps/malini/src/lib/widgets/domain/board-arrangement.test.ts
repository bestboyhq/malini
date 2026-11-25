import { describe, expect, it } from 'vitest';
import { type WidgetBoard, type WidgetDefinition } from '$contract/widgets';
import { placedAt, removed, resized, unplaced } from './board-arrangement';

const BOARD: WidgetBoard = {
	board: 'acme/app',
	workstreamId: 'ws',
	widgets: [],
	repository: 'acme/app',
	placements: [],
	readings: [],
	me: null,
};

function widget(id: string, origin: WidgetDefinition['origin']): WidgetDefinition {
	return {
		id,
		title: id,
		icon: null,
		scope: 'shared',
		source:
			origin === 'plan'
				? { kind: 'plan' }
				: { kind: 'github', path: 'repos/{owner}/{repo}', select: null },
		refresh: { everySeconds: 300, on: [] },
		url: null,
		author: null,
		fingerprint: id,
		origin,
	};
}

const board: WidgetBoard = {
	...BOARD,
	widgets: [widget('plan', 'plan'), widget('ci', 'shared'), widget('rooms', 'mine')],
	placements: [
		{ widgetId: 'rooms', span: { columns: 3, rows: 1 } },
		{ widgetId: 'ci', span: { columns: 1, rows: 1 } },
	],
};

describe('board arrangement', () => {
	it('moves a placed widget and keeps its span', () => {
		expect(placedAt(board, 'rooms', 1).placements).toEqual([
			{ widgetId: 'ci', span: { columns: 1, rows: 1 } },
			{ widgetId: 'rooms', span: { columns: 3, rows: 1 } },
		]);
	});

	it('adds a widget at its first span, the Plan full width', () => {
		expect(placedAt(board, 'plan', 0).placements[0]).toEqual({
			widgetId: 'plan',
			span: { columns: 12, rows: 2 },
		});
	});

	it('resizes one widget', () => {
		expect(resized(board, 'ci', { columns: 2, rows: 2 }).placements[1]?.span).toEqual({
			columns: 2,
			rows: 2,
		});
	});

	it('forgets your own widget on remove and keeps a shared one to add again', () => {
		const left = removed(removed(board, 'rooms'), 'ci');
		expect(left.placements).toEqual([]);
		expect(unplaced(left).map(({ id }) => id)).toEqual(['plan', 'ci']);
	});
});
