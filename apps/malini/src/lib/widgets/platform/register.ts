import { isWidgetSize, type WidgetSize } from '$contract/widgets';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { WidgetBoards, type SavedWidget, type WidgetsDeps } from './widget-boards.service';
import { WidgetError, isWidgetId } from './widget-files';

export type { SavedWidget, WidgetsDeps };

export type WidgetsPlatform = Readonly<{
	save(workstreamId: string, input: unknown): Promise<SavedWidget>;
	dispose(): void;
}>;

const WORKSTREAM_ID_MAX_LENGTH = 200;

export function registerWidgets(context: MainContext, deps: WidgetsDeps): WidgetsPlatform {
	const { commands } = context;
	const boards = new WidgetBoards(context, deps);

	commands.define('widgets.board', (args: unknown) => boards.board(workstreamId(args)));

	commands.define('widgets.place', (args: unknown) =>
		boards.place(workstreamId(args), widgetId(args), index(args), size(args, true)),
	);

	commands.define('widgets.resize', (args: unknown) =>
		boards.resize(workstreamId(args), widgetId(args), size(args, false) ?? 'small'),
	);

	commands.define('widgets.remove', (args: unknown) =>
		boards.remove(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.hide', (args: unknown) =>
		boards.hide(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.refresh', (args: unknown) =>
		boards.refresh(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.watch', (args: unknown) => {
		const watching = field(args, 'watching');
		if (typeof watching !== 'boolean') throw invalid('`watching` must be true or false');
		boards.watch(workstreamId(args), watching);
	});

	return {
		save: (id, input) => boards.save(id, input),
		dispose: () => boards.dispose(),
	};
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function workstreamId(args: unknown): string {
	const value = field(args, 'workstreamId');
	if (typeof value !== 'string' || value.trim() === '' || value.length > WORKSTREAM_ID_MAX_LENGTH) {
		throw invalid('`workstreamId` must be an id');
	}
	return value;
}

function widgetId(args: unknown): string {
	const value = field(args, 'widgetId');
	if (!isWidgetId(value)) throw invalid('`widgetId` must be a widget id');
	return value;
}

function index(args: unknown): number | null {
	const value = field(args, 'index');
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw invalid('`index` must be null or a whole number from 0');
	}
	return value;
}

function size(args: unknown, nullable: boolean): WidgetSize | null {
	const value = field(args, 'size');
	if (nullable && value === null) return null;
	if (!isWidgetSize(value)) throw invalid('`size` must be `small`, `medium` or `large`');
	return value;
}

function invalid(message: string): WidgetError {
	return new WidgetError('invalid-argument', `invalid args: ${message}`);
}
