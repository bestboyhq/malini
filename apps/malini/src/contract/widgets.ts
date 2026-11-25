export const WIDGET_SIZES = ['small', 'medium', 'large'] as const;

export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const WIDGET_SPAN_MAX = 12;

export type WidgetSpan = Readonly<{ columns: number; rows: number }>;

export const WIDGET_DEFAULT_SPAN: WidgetSpan = { columns: 2, rows: 1 };

export const PLAN_WIDGET_SPAN: WidgetSpan = { columns: WIDGET_SPAN_MAX, rows: 2 };

export const WIDGET_ORIGINS = ['plan', 'shared', 'mine'] as const;

export type WidgetOrigin = (typeof WIDGET_ORIGINS)[number];

export const WIDGET_SCOPES = ['shared', 'own'] as const;

export type WidgetScope = (typeof WIDGET_SCOPES)[number];

export const WIDGET_STATES = ['success', 'failure', 'running', 'idle'] as const;

export type WidgetState = (typeof WIDGET_STATES)[number];

export const WIDGETS_FOLDER = '.malini/widgets';

export const PLAN_WIDGET_ID = 'plan';

export const WIDGET_TEXT_MAX_LENGTH = 200;

export const WIDGET_ROWS_MAX = 50;

export const WIDGET_HISTORY_MAX = 30;

export const WIDGET_METHODS = ['GET', 'POST'] as const;

export type WidgetMethod = (typeof WIDGET_METHODS)[number];

export type WidgetSource =
	| Readonly<{ kind: 'github'; path: string; select: string | null }>
	| Readonly<{
			kind: 'http';
			url: string;
			method: WidgetMethod;
			headers: Readonly<Record<string, string>>;
			body: Readonly<Record<string, unknown>> | null;
			keyUrl: string | null;
			select: string | null;
	  }>
	| Readonly<{ kind: 'retired'; line: string }>
	| Readonly<{ kind: 'plan' }>;

export type WidgetNeed = Readonly<{ missing: readonly string[] }>;

const KEY_PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;

export function widgetKeyNames(headers: Readonly<Record<string, string>>): string[] {
	return [
		...new Set(
			Object.values(headers).flatMap((value) =>
				[...value.matchAll(KEY_PLACEHOLDER)].flatMap(([, name]) => name ?? []),
			),
		),
	];
}

export function fillWidgetKeys(value: string, keys: Readonly<Record<string, string>>): string {
	return value.replace(KEY_PLACEHOLDER, (placeholder, name: string) => keys[name] ?? placeholder);
}

export function widgetSite(url: string): string {
	return URL.parse(url)?.host ?? url;
}

export type WidgetRefresh = Readonly<{ everySeconds: number; on: readonly string[] }>;

export type WidgetDefinition = Readonly<{
	id: string;
	title: string;
	icon: string | null;
	scope: WidgetScope;
	source: WidgetSource;
	refresh: WidgetRefresh;
	url: string | null;
	author: string | null;
	fingerprint: string;
	origin: WidgetOrigin;
}>;

export type WidgetRow = Readonly<{
	label: string;
	value: number | string | null;
	max: number | null;
	detail: string | null;
	state: WidgetState | null;
	url: string | null;
}>;

export const WIDGET_CHART_KINDS = ['line', 'bar'] as const;

export type WidgetChartKind = (typeof WIDGET_CHART_KINDS)[number];

export const WIDGET_CHART_SERIES_MAX = 3;

export const WIDGET_CHART_POINTS_MAX = 120;

export type WidgetChartSeries = Readonly<{
	label: string | null;
	values: readonly (number | null)[];
}>;

export type WidgetChart = Readonly<{
	kind: WidgetChartKind;
	labels: readonly string[];
	series: readonly WidgetChartSeries[];
}>;

export type WidgetData = Readonly<{
	value: number | string | null;
	unit: string | null;
	caption: string | null;
	delta: string | null;
	percent: number | null;
	state: WidgetState | null;
	history: readonly WidgetState[];
	rows: readonly WidgetRow[];
	chart: WidgetChart | null;
	url: string | null;
}>;

export type WidgetReading = Readonly<{
	board: string;
	widgetId: string;
	fingerprint: string;
	data: WidgetData | null;
	readAt: string | null;
	error: string | null;
	need: WidgetNeed | null;
	attemptedAt: string | null;
	reading: boolean;
}>;

export type WidgetPlacement = Readonly<{
	widgetId: string;
	span: WidgetSpan;
}>;

export type WidgetBoard = Readonly<{
	board: string;
	workstreamId: string;
	widgets: readonly WidgetDefinition[];
	repository: string | null;
	placements: readonly WidgetPlacement[];
	readings: readonly WidgetReading[];
	me: string | null;
}>;

export type WidgetBoardArgs = Readonly<{ workstreamId: string }>;

export type PlaceWidgetArgs = Readonly<{
	workstreamId: string;
	widgetId: string;
	index: number;
}>;

export type ResizeWidgetArgs = Readonly<{
	workstreamId: string;
	widgetId: string;
	span: WidgetSpan;
}>;

export type WidgetArgs = Readonly<{ workstreamId: string; widgetId: string }>;

export type AllowWidgetKeysArgs = Readonly<{
	workstreamId: string;
	widgetId: string;
	values: Readonly<Record<string, string>>;
}>;

export type ShareWidgetArgs = Readonly<{ workstreamId: string; widgetId: string }>;

export type WatchWidgetsArgs = Readonly<{ workstreamId: string; watching: boolean }>;

export type PinPlanWidgetArgs = Readonly<{ repositoryFullName: string }>;

export type WidgetBoardChangedEvent = Readonly<{ board: string }>;

export function isWidgetSpan(value: unknown): value is WidgetSpan {
	return isObject(value) && isSpanLength(value['columns']) && isSpanLength(value['rows']);
}

function isSpanLength(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= WIDGET_SPAN_MAX;
}

export function isWidgetState(value: unknown): value is WidgetState {
	return WIDGET_STATES.some((state) => state === value);
}

export function parseWidgetData(value: unknown): WidgetData | null {
	if (!isObject(value)) return null;
	return {
		value: scalar(value['value']),
		unit: text(value['unit']),
		caption: text(value['caption']),
		delta: text(value['delta']),
		percent: percent(value['percent']),
		state: isWidgetState(value['state']) ? value['state'] : null,
		history: Array.isArray(value['history'])
			? value['history'].filter(isWidgetState).slice(-WIDGET_HISTORY_MAX)
			: [],
		rows: Array.isArray(value['rows'])
			? value['rows'].flatMap((row) => widgetRow(row) ?? []).slice(0, WIDGET_ROWS_MAX)
			: [],
		chart: widgetChart(value['chart']),
		url: webUrl(value['url']),
	};
}

function widgetChart(value: unknown): WidgetChart | null {
	if (!isObject(value) || !Array.isArray(value['series'])) return null;
	const kind = WIDGET_CHART_KINDS.find((each) => each === value['kind']);
	if (kind === undefined) return null;
	const all = value['series']
		.flatMap((each) => chartSeries(each) ?? [])
		.slice(0, WIDGET_CHART_SERIES_MAX);
	const points = Math.max(0, ...all.map(({ values }) => values.length));
	const from = Math.max(0, points - WIDGET_CHART_POINTS_MAX);
	const series = all
		.map((each) => ({ ...each, values: each.values.slice(from) }))
		.filter(({ values }) => values.length > 0);
	if (!series.some(({ values }) => values.some((point) => point !== null))) return null;
	const labels = Array.isArray(value['labels']) ? value['labels'].slice(from, points) : [];
	return { kind, labels: labels.map((label) => text(label) ?? ''), series };
}

function chartSeries(value: unknown): WidgetChartSeries | null {
	if (!isObject(value) || !Array.isArray(value['values'])) return null;
	return { label: text(value['label']), values: value['values'].map((point) => finite(point)) };
}

function widgetRow(value: unknown): WidgetRow | null {
	if (!isObject(value)) return null;
	const label = text(value['label']);
	if (label === null) return null;
	return {
		label,
		value: scalar(value['value']),
		max: finite(value['max']),
		detail: text(value['detail']),
		state: isWidgetState(value['state']) ? value['state'] : null,
		url: webUrl(value['url']),
	};
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed.slice(0, WIDGET_TEXT_MAX_LENGTH);
}

function finite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scalar(value: unknown): number | string | null {
	return finite(value) ?? text(value);
}

function percent(value: unknown): number | null {
	const number = finite(value);
	return number === null ? null : Math.min(100, Math.max(0, number));
}

function webUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}
