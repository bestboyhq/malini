import type { WidgetDefinition, WidgetNeed, WidgetSpan, WidgetState } from '$contract/widgets';
import { shownSpan } from './widget-grid';

export const WIDGET_STATE_NAMES: Readonly<Record<WidgetState, string>> = {
	success: 'Passed',
	failure: 'Failed',
	running: 'Running',
	idle: 'Idle',
};

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

export function updatedLabel(readAt: string | null, now: Date): string {
	const at = readAt === null ? Number.NaN : Date.parse(readAt);
	if (Number.isNaN(at)) return 'Not read yet';
	const ago = now.getTime() - at;
	if (ago < MINUTE) return 'Updated just now';
	if (ago < HOUR) return `Updated ${Math.floor(ago / MINUTE)} min ago`;
	if (ago < DAY) return `Updated ${Math.floor(ago / HOUR)} h ago`;
	return `Updated ${Math.floor(ago / DAY)} d ago`;
}

export function sourceLine({ source }: WidgetDefinition): string {
	switch (source.kind) {
		case 'github':
			return source.select === null
				? `gh api ${source.path}`
				: `gh api ${source.path} --jq '${source.select}'`;
		case 'mcp':
			return `${source.server} · ${source.tool}`;
		case 'command':
			return `Runs ${source.run}`;
		case 'plan':
			return 'Your plan';
	}
}

const NEED_ACTIONS: Readonly<Record<WidgetNeed, (server: string) => string>> = {
	add: (server) => `Add ${server}`,
	'sign-in': (server) => `Sign in to ${server}`,
	'turn-on': (server) => `Turn on ${server}`,
};

export function needAction({ source }: WidgetDefinition, need: WidgetNeed): string | null {
	return source.kind === 'mcp' ? NEED_ACTIONS[need](source.server) : null;
}

export function tileName(widget: WidgetDefinition, span: WidgetSpan, columns: number): string {
	const shown = shownSpan(span, columns);
	return `${widget.title}, ${shown.columns} by ${shown.rows}`;
}

export function widgetValue(value: number | string): string {
	return typeof value === 'number' ? NUMBER.format(value) : value;
}

export type WidgetDelta = Readonly<{ direction: 'up' | 'down' | null; text: string }>;

export function deltaOf(delta: string): WidgetDelta {
	const sign = delta.match(/^\s*([+\-−])\s*/u);
	if (sign === null) return { direction: null, text: delta };
	return { direction: sign[1] === '+' ? 'up' : 'down', text: delta.slice(sign[0].length) };
}

export function runsLabel(runs: readonly WidgetState[]): string {
	const failed = runs.filter((run) => run === 'failure').length;
	const total = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`;
	return failed === 0 ? `${total}. None failed` : `${total}. ${failed} failed`;
}
