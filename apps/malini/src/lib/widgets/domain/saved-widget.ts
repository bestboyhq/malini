import {
	parseWidgetData,
	WIDGET_NEEDS,
	type WidgetDefinition,
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
	const path = text(value['github']) ?? (value['kind'] === 'github' ? text(value['path']) : null);
	if (path !== null) return { kind: 'github', path, select: text(value['select']) };
	const mcp = mcpOf(isFields(value['mcp']) ? value['mcp'] : value);
	if (mcp !== null) return { ...mcp, select: text(value['select']) };
	const run = text(value['command']) ?? (value['kind'] === 'command' ? text(value['run']) : null);
	if (run !== null) return { kind: 'command', run };
	return value['kind'] === 'plan' ? { kind: 'plan' } : null;
}

function mcpOf(value: Fields): Omit<Extract<WidgetSource, { kind: 'mcp' }>, 'select'> | null {
	const server = text(value['server']);
	const tool = text(value['tool']);
	if (server === null || tool === null) return null;
	const args = isFields(value['arguments']) ? value['arguments'] : {};
	return { kind: 'mcp', server, tool, arguments: args, url: text(value['url']) };
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
		need: WIDGET_NEEDS.find((need) => need === value['need']) ?? null,
		attemptedAt: text(value['attemptedAt']),
		reading: value['reading'] === true,
	};
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
