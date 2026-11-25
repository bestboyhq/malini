import {
	parseWidgetData,
	type WidgetDefinition,
	type WidgetNeed,
	type WidgetReading,
	type WidgetSource,
} from '$contract/widgets';

export type SavedWidget = Readonly<{
	widget: WidgetDefinition | null;
	reading: WidgetReading | null;
}>;

type Fields = Readonly<Record<string, unknown>>;

const DEFAULT_EVERY_SECONDS = 300;

export function savedWidget(input: Fields, output: string | null): SavedWidget {
	const result = parsed(output);
	const widget = definitionOf(result['widget']) ?? definitionOf(input);
	return {
		widget,
		reading: widget === null ? null : readingOf(result['reading'], widget.id),
	};
}

function definitionOf(value: unknown): WidgetDefinition | null {
	if (!isFields(value)) return null;
	const title = text(value['title']);
	const source = sourceOf(value['source']);
	if (title === null || source === null) return null;
	const refresh = isFields(value['refresh']) ? value['refresh'] : {};
	return {
		id: text(value['id']) ?? '',
		title,
		icon: text(value['icon']),
		scope: value['scope'] === 'own' ? 'own' : 'shared',
		source,
		refresh: {
			everySeconds:
				count(refresh['everySeconds']) ?? count(refresh['every']) ?? DEFAULT_EVERY_SECONDS,
			on: Array.isArray(refresh['on']) ? refresh['on'].filter(isText) : [],
		},
		url: text(value['url']),
		author: text(value['author']),
		fingerprint: text(value['fingerprint']) ?? '',
		origin: value['origin'] === 'shared' ? 'shared' : 'mine',
	};
}

function sourceOf(value: unknown): WidgetSource | null {
	if (!isFields(value)) return null;
	const select = text(value['select']);
	const path = text(value['github']) ?? (value['kind'] === 'github' ? text(value['path']) : null);
	if (path !== null) return { kind: 'github', path, select };
	const request = isFields(value['http']) ? value['http'] : value['kind'] === 'http' ? value : null;
	const http = request === null ? null : httpOf(request);
	if (http !== null) return { ...http, select };
	const line = value['kind'] === 'retired' ? text(value['line']) : retiredLine(value);
	if (line !== null) return { kind: 'retired', line };
	return value['kind'] === 'plan' ? { kind: 'plan' } : null;
}

function httpOf(value: Fields): Omit<Extract<WidgetSource, { kind: 'http' }>, 'select'> | null {
	const url = text(value['url']);
	if (url === null) return null;
	const method = text(value['method'])?.toUpperCase() === 'POST' ? 'POST' : 'GET';
	const headers = isFields(value['headers']) ? Object.entries(value['headers']) : [];
	return {
		kind: 'http',
		url,
		method,
		headers: Object.fromEntries(
			headers.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
		),
		body: isFields(value['body']) ? value['body'] : null,
		keyUrl: text(value['keyUrl']),
	};
}

function retiredLine(value: Fields): string | null {
	const run = text(value['command']);
	if (run !== null) return `Runs ${run}`;
	const mcp = isFields(value['mcp']) ? value['mcp'] : {};
	const server = text(mcp['server']);
	const tool = text(mcp['tool']);
	return server === null || tool === null ? null : `${server} · ${tool}`;
}

function readingOf(value: unknown, widgetId: string): WidgetReading | null {
	if (!isFields(value)) return null;
	return {
		board: text(value['board']) ?? '',
		widgetId,
		fingerprint: text(value['fingerprint']) ?? '',
		data: parseWidgetData(value['data']),
		readAt: text(value['readAt']),
		error: text(value['error']),
		need: needOf(value['need']),
		attemptedAt: text(value['attemptedAt']),
		reading: value['reading'] === true,
	};
}

function needOf(value: unknown): WidgetNeed | null {
	if (!isFields(value) || !Array.isArray(value['missing'])) return null;
	return { missing: value['missing'].filter(isText) };
}

function parsed(output: string | null): Fields {
	if (output === null) return {};
	try {
		const value: unknown = JSON.parse(output);
		return isFields(value) ? value : {};
	} catch {
		return {};
	}
}

function isFields(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function text(value: unknown): string | null {
	return isText(value) ? value.trim() : null;
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
