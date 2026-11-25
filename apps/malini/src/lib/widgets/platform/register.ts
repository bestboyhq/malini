import { WIDGET_SPAN_MAX, isWidgetSpan, type WidgetSpan } from '$contract/widgets';
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

const GITHUB_REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u;

export function registerWidgets(context: MainContext, deps: WidgetsDeps): WidgetsPlatform {
	const { commands } = context;
	const sharedCheckMs = context.isDev ? Number(process.env['MALINI_WIDGETS_CHECK_MS']) : Number.NaN;
	const boards = new WidgetBoards(context, sharedCheckMs > 0 ? { ...deps, sharedCheckMs } : deps);

	commands.define('widgets.board', (args: unknown) => boards.board(workstreamId(args)));

	commands.define('widgets.place', (args: unknown) =>
		boards.place(workstreamId(args), widgetId(args), index(args)),
	);

	commands.define('widgets.resize', (args: unknown) =>
		boards.resize(workstreamId(args), widgetId(args), span(args)),
	);

	commands.define('widgets.remove', (args: unknown) =>
		boards.remove(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.share', (args: unknown) =>
		boards.share(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.pin-plan', (args: unknown) => {
		const repository = field(args, 'repositoryFullName');
		if (typeof repository !== 'string' || !GITHUB_REPOSITORY.test(repository)) {
			throw invalid('`repositoryFullName` must be a GitHub owner/name');
		}
		boards.pinPlan(repository);
	});

	commands.define('widgets.connect', (args: unknown) =>
		boards.connect(workstreamId(args), widgetId(args)),
	);

	commands.define('widgets.cancel-connect', () => boards.cancelConnect());

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

function index(args: unknown): number {
	const value = field(args, 'index');
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw invalid('`index` must be a whole number from 0');
	}
	return value;
}

function span(args: unknown): WidgetSpan {
	const value = field(args, 'span');
	if (!isWidgetSpan(value)) {
		throw invalid(`\`span\` must be whole \`columns\` and \`rows\` from 1 to ${WIDGET_SPAN_MAX}`);
	}
	return { columns: value.columns, rows: value.rows };
}

function invalid(message: string): WidgetError {
	return new WidgetError('invalid-argument', `invalid args: ${message}`);
}
