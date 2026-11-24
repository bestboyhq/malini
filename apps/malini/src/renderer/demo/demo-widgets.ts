import type { Initiative } from '$contract/initiatives';
import {
	PLAN_WIDGET_ID,
	PLAN_WIDGET_SPAN,
	WIDGET_DEFAULT_SPAN,
	type WidgetBoard,
	type WidgetChart,
	type WidgetData,
	type WidgetDefinition,
	type WidgetPlacement,
	type WidgetReading,
	type WidgetSpan,
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

function lastDays(count: number): string[] {
	return Array.from({ length: count }, (_, index) => {
		const day = new Date();
		day.setDate(day.getDate() - (count - 1 - index));
		return day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	});
}

type DemoWidget = Readonly<{ widget: WidgetDefinition; span: WidgetSpan; data: WidgetData | null }>;

const EMPTY: WidgetData = {
	value: null,
	unit: null,
	caption: null,
	delta: null,
	percent: null,
	state: null,
	history: [],
	rows: [],
	chart: null,
	url: null,
};

const VISITS: WidgetChart = {
	kind: 'line',
	labels: lastDays(14),
	series: [
		{
			label: 'Visits',
			values: [182, 205, 241, 198, 167, 154, 263, 288, 312, 276, 251, 229, 334, 371],
		},
		{ label: 'Sign-ups', values: [9, 12, 15, 11, 8, 7, 17, 19, 22, 18, 16, 14, 24, 27] },
	],
};

const REGIONS: WidgetChart = {
	kind: 'bar',
	labels: ['Europe', 'North America', 'Asia', 'South America', 'Oceania'],
	series: [{ label: 'Rounds', values: [412, 356, 198, 87, 41] }],
};

const DEPLOYS: WidgetChart = {
	kind: 'bar',
	labels: lastDays(14),
	series: [{ label: 'Deploys', values: [3, 5, 2, 0, 0, 4, 6, 3, 7, 5, 0, 0, 4, 6] }],
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
		url: null,
		author: OWNER,
		fingerprint: id,
		origin: 'shared',
		...fields,
	};
}

const SMALL: WidgetSpan = { columns: 1, rows: 1 };

const WIDGETS: readonly DemoWidget[] = [
	{
		widget: widget(PLAN_WIDGET_ID, 'Plan', 'checklist', {
			source: { kind: 'plan' },
			author: null,
			origin: 'plan',
		}),
		span: PLAN_WIDGET_SPAN,
		data: null,
	},
	{
		widget: widget('deploy', 'Deploy', 'workflow', {
			refresh: { everySeconds: 120, on: ['pull-requests:ship-changed'] },
		}),
		span: SMALL,
		data: {
			...EMPTY,
			state: 'success',
			caption: 'Production',
			history: ['success', 'success', 'failure', 'success', 'success', 'running', 'success'],
		},
	},
	{
		widget: widget('reviews', 'Reviews', 'pr-open', { scope: 'own', origin: 'mine' }),
		span: SMALL,
		data: { ...EMPTY, value: 3, unit: 'open', caption: '1 waits on you' },
	},
	{
		widget: widget('visits', 'Visits', 'trend-up', {}),
		span: { columns: 2, rows: 2 },
		data: {
			...EMPTY,
			value: 3971,
			unit: 'visits',
			delta: '+18%',
			caption: 'Last 14 days',
			chart: VISITS,
		},
	},
	{
		widget: widget('release', 'Release', 'layers', {}),
		span: WIDGET_DEFAULT_SPAN,
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
		widget: widget('regions', 'Rounds by region', 'globe', {}),
		span: WIDGET_DEFAULT_SPAN,
		data: { ...EMPTY, chart: REGIONS },
	},
	{
		widget: widget('deploys', 'Deploys', 'workflow', {}),
		span: WIDGET_DEFAULT_SPAN,
		data: {
			...EMPTY,
			value: 45,
			unit: 'deploys',
			delta: '-6%',
			caption: 'Per day',
			chart: DEPLOYS,
		},
	},
	{
		widget: widget('downloads', 'Downloads', 'trend-up', {}),
		span: SMALL,
		data: { ...EMPTY, value: 1284, unit: 'this week', delta: '+18%' },
	},
];

const PLACED: readonly WidgetPlacement[] = [
	'plan',
	'deploy',
	'reviews',
	'visits',
	'release',
	'regions',
].map((widgetId) => ({ widgetId, span: spanOf(widgetId) }));

const boards = new Map<string, { placements: WidgetPlacement[] }>();

function spanOf(widgetId: string): WidgetSpan {
	return WIDGETS.find(({ widget }) => widget.id === widgetId)?.span ?? WIDGET_DEFAULT_SPAN;
}

function boardKey(workstreamId: string): string {
	return `${OWNER}/${workstreamOf(workstreamId)?.projectId ?? 'malini'}`;
}

function layoutOf(board: string): { placements: WidgetPlacement[] } {
	const known = boards.get(board);
	if (known) return known;
	const fresh = { placements: [...PLACED] };
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
	return {
		board,
		workstreamId,
		widgets: WIDGETS.map(({ widget }) => widget),
		repository: board,
		placements: [...layoutOf(board).placements],
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
		done: false,
		note: null,
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
		done: false,
		note: null,
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
		assignee: OWNER,
	};
}

export const widgetHandlers = (emit: DemoEmit): DemoHandlers => ({
	'widgets.board': ({ workstreamId }) => boardOf(workstreamId),
	'widgets.watch': () => undefined,
	'widgets.share': () => undefined,
	'widgets.place': ({ workstreamId, widgetId, index }) => {
		const layout = layoutOf(boardKey(workstreamId));
		const current = layout.placements.find((placement) => placement.widgetId === widgetId);
		const rest = layout.placements.filter((placement) => placement.widgetId !== widgetId);
		rest.splice(index, 0, { widgetId, span: current?.span ?? spanOf(widgetId) });
		layout.placements = rest;
		return changed(emit, workstreamId);
	},
	'widgets.resize': ({ workstreamId, widgetId, span }) => {
		const layout = layoutOf(boardKey(workstreamId));
		layout.placements = layout.placements.map((placement) =>
			placement.widgetId === widgetId ? { ...placement, span } : placement,
		);
		return changed(emit, workstreamId);
	},
	'widgets.remove': ({ workstreamId, widgetId }) => {
		const layout = layoutOf(boardKey(workstreamId));
		layout.placements = layout.placements.filter((placement) => placement.widgetId !== widgetId);
		return changed(emit, workstreamId);
	},
	'initiatives.list': () => [...PLAN],
	'initiatives.sync-state': ({ repositoryFullName }) => ({
		repositoryFullName,
		enabled: true,
		home: repositoryFullName,
		syncedAt: minutesAgo(0.05),
		error: null,
		people: [OWNER],
		waitingFor: null,
		requestedBy: [],
	}),
	'initiatives.sync': () => [...PLAN],
	'initiatives.share-requests': () => [],
});
