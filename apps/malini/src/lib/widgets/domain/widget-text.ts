import type { WidgetDefinition, WidgetSize, WidgetState } from '$contract/widgets';

export const WIDGET_SIZE_NAMES: Readonly<Record<WidgetSize, string>> = {
	small: 'Small',
	medium: 'Medium',
	large: 'Large',
};

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
		case 'command':
			return `Runs ${source.run}`;
		case 'plan':
			return 'Your plan';
	}
}

export function tileName(widget: WidgetDefinition, size: WidgetSize): string {
	return `${widget.title}, ${WIDGET_SIZE_NAMES[size]}`;
}

export function widgetValue(value: number | string): string {
	return typeof value === 'number' ? NUMBER.format(value) : value;
}

export function runsLabel(runs: readonly WidgetState[]): string {
	const failed = runs.filter((run) => run === 'failure').length;
	const total = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`;
	return failed === 0 ? `${total}. None failed` : `${total}. ${failed} failed`;
}
