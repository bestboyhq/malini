import type { Initiative } from '$contract/initiatives';
import {
	PLAN_WIDGET_ID,
	type WidgetBoard,
	type WidgetData,
	type WidgetDefinition,
	type WidgetPlacement,
	type WidgetReading,
	type WidgetSize,
} from '$contract/widgets';
import type { DemoEmit, DemoHandlers } from './demo-bridge';
import { OWNER } from './demo-data';
import { workstreamOf } from './demo-live';

function minutesAgo(minutes: number): string {
	return new Date(Date.now() - minutes * 60_000).toISOString();
}

function daysFromNow(days: number): string {
	const day = new Date();
	day.setDate(day.getDate() + days);
	const month = String(day.getMonth() + 1).padStart(2, '0');
	return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

type DemoWidget = Readonly<{ widget: WidgetDefinition; data: WidgetData | null }>;

const EMPTY: WidgetData = {
	value: null,
	unit: null,
	caption: null,
	delta: null,
	percent: null,
	state: null,
	history: [],
	rows: [],
	url: null,
};

function widget(
	id: string,
	title: string,
	icon: string,
	fields: Partial<WidgetDefinition>,
): WidgetDefinition {
	return {
		id,
		title,
		icon,
		scope: 'shared',
		source: { kind: 'github', path: `repos/{owner}/{repo}/${id}`, select: null },
		refresh: { everySeconds: 300, on: [] },
		size: 'small',
		url: null,
		author: OWNER,
		fingerprint: id,
		path: `.malini/widgets/${id}.json`,
		...fields,
	};
}

const WIDGETS: readonly DemoWidget[] = [
	{
		widget: widget(PLAN_WIDGET_ID, 'Plan', 'checklist', {
			source: { kind: 'plan' },
			size: 'large',
			author: null,
			path: null,
		}),
		data: null,
	},
	{
		widget: widget('deploy', 'Deploy', 'workflow', {
			refresh: { everySeconds: 120, on: ['pull-requests:ship-changed'] },
		}),
		data: {
			...EMPTY,
			state: 'success',
			caption: 'Production',
			history: ['success', 'success', 'failure', 'success', 'success', 'running', 'success'],
		},
	},
	{
		widget: widget('reviews', 'Reviews', 'pr-open', { scope: 'own' }),
		data: { ...EMPTY, value: 3, unit: 'open', caption: '1 waits on you' },
	},
	{
		widget: widget('release', 'Release', 'layers', { size: 'medium' }),
		data: {
			...EMPTY,
			percent: 72,
			caption: 'v0.117',
			rows: [
				{ label: 'Widgets', value: 8, max: 10, detail: null, state: 'running', url: null },
				{ label: 'Plan sync', value: 5, max: 6, detail: null, state: 'running', url: null },
				{ label: 'Docs', value: 3, max: 3, detail: null, state: 'success', url: null },
			],
		},
	},
	{
		widget: widget('downloads', 'Downloads', 'trend-up', {}),
		data: { ...EMPTY, value: 1284, unit: 'this week', delta: '+18%' },
	},
];

const PLACED: readonly WidgetPlacement[] = ['plan', 'deploy', 'reviews', 'release'].map(
	(widgetId) => ({ widgetId, size: sizeOf(widgetId), approved: true }),
);

const boards = new Map<string, { placements: WidgetPlacement[]; hidden: string[] }>();

function sizeOf(widgetId: string): WidgetSize {
	return WIDGETS.find(({ widget }) => widget.id === widgetId)?.widget.size ?? 'small';
}

function boardKey(workstreamId: string): string {
	return `${OWNER}/${workstreamOf(workstreamId)?.projectId ?? 'malini'}`;
}

function layoutOf(board: string): { placements: WidgetPlacement[]; hidden: string[] } {
	const known = boards.get(board);
	if (known) return known;
	const fresh = { placements: [...PLACED], hidden: [] };
	boards.set(board, fresh);
	return fresh;
}

function reading(board: string, { widget, data }: DemoWidget): WidgetReading {
	return {
		board,
		widgetId: widget.id,
		fingerprint: widget.fingerprint,
		data,
		readAt: data ? minutesAgo(2) : null,
		error: null,
		attemptedAt: data ? minutesAgo(2) : null,
		reading: false,
	};
}

function boardOf(workstreamId: string): WidgetBoard {
	const board = boardKey(workstreamId);
	const { placements, hidden } = layoutOf(board);
	return {
		board,
		workstreamId,
		widgets: WIDGETS.map(({ widget }) => widget),
		placements: [...placements],
		hidden: [...hidden],
		readings: WIDGETS.filter(({ data }) => data).map((entry) => reading(board, entry)),
		me: OWNER,
	};
}

function changed(emit: DemoEmit, workstreamId: string): WidgetBoard {
	const board = boardOf(workstreamId);
	emit('widgets:board-changed', { board: board.board });
	return board;
}

const PLAN: readonly Initiative[] = [
	{
		id: 'demo-widgets',
		repositoryFullName: `${OWNER}/malini`,
		title: 'Widgets in the right panel',
		dueOn: daysFromNow(3),
		note: null,
		githubMilestone: null,
		dependencies: [
			dependency('demo-board', 'Bento board', true),
			dependency('demo-tool', 'widgets_save tool', true),
			dependency('demo-sync', 'Plan sync with GitHub', false),
		],
	},
	{
		id: 'demo-launch',
		repositoryFullName: `${OWNER}/malini`,
		title: 'Launch on the site',
		dueOn: daysFromNow(11),
		note: null,
		githubMilestone: null,
		dependencies: [
			dependency('demo-docs', 'Widgets docs page', false),
			dependency('demo-demo', 'Demo board', false),
		],
	},
];

function dependency(id: string, title: string, done: boolean): Initiative['dependencies'][number] {
	return {
		id,
		title,
		done,
		note: null,
		workstreams: [],
		githubIssue: null,
		assignee: OWNER,
	};
}

export const widgetHandlers = (emit: DemoEmit): DemoHandlers => ({
	'widgets.board': ({ workstreamId }) => boardOf(workstreamId),
	'widgets.watch': () => undefined,
	'widgets.refresh': ({ workstreamId, widgetId }) => {
		const entry = WIDGETS.find(({ widget }) => widget.id === widgetId) ?? WIDGETS[0];
		return entry ? reading(boardKey(workstreamId), entry) : Promise.reject(new Error(widgetId));
	},
	'widgets.place': ({ workstreamId, widgetId, index, size }) => {
		const layout = layoutOf(boardKey(workstreamId));
		const current = layout.placements.find((placement) => placement.widgetId === widgetId);
		const rest = layout.placements.filter((placement) => placement.widgetId !== widgetId);
		const placed = { widgetId, size: size ?? current?.size ?? sizeOf(widgetId), approved: true };
		rest.splice(index ?? rest.length, 0, placed);
		layout.placements = rest;
		layout.hidden = layout.hidden.filter((id) => id !== widgetId);
		return changed(emit, workstreamId);
	},
	'widgets.resize': ({ workstreamId, widgetId, size }) => {
		const layout = layoutOf(boardKey(workstreamId));
		layout.placements = layout.placements.map((placement) =>
			placement.widgetId === widgetId ? { ...placement, size } : placement,
		);
		return changed(emit, workstreamId);
	},
	'widgets.remove': ({ workstreamId, widgetId }) => {
		const layout = layoutOf(boardKey(workstreamId));
		layout.placements = layout.placements.filter((placement) => placement.widgetId !== widgetId);
		return changed(emit, workstreamId);
	},
	'widgets.hide': ({ workstreamId, widgetId }) => {
		const layout = layoutOf(boardKey(workstreamId));
		layout.hidden = [...layout.hidden.filter((id) => id !== widgetId), widgetId];
		return changed(emit, workstreamId);
	},
	'initiatives.list': () => [...PLAN],
	'initiatives.sync-state': ({ repositoryFullName }) => ({
		repositoryFullName,
		enabled: true,
		private: true,
		syncedAt: minutesAgo(0.05),
		error: null,
		people: [OWNER],
	}),
	'initiatives.sync': () => [...PLAN],
});
