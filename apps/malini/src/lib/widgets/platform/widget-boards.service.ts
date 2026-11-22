import { isEventChannel } from '$contract/events';
import {
	PLAN_WIDGET_ID,
	WIDGETS_FOLDER,
	type WidgetBoard,
	type WidgetDefinition,
	type WidgetPlacement,
	type WidgetReading,
	type WidgetSize,
} from '$contract/widgets';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { isRecord } from '$main/db/rows';
import type { SecretsPlatform } from '$lib/secrets/secrets.platform';
import {
	getWorkstream,
	githubFullNameFromRemote,
	readOrigin,
	workstreamRepositoryName,
	type RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';
import {
	PLAN_WIDGET,
	WidgetError,
	freeWidgetId,
	isGithubLogin,
	isWidgetChannel,
	parseWidgetFile,
	readWidgetFiles,
	widgetPath,
	writeWidgetFile,
} from './widget-files';
import { readWidgetSource, type SourceDeps } from './widget-sources';
import {
	getReading,
	hideWidget,
	listHidden,
	listPlacements,
	placeWidget,
	recordFailedRead,
	recordRead,
	removePlacement,
	resizePlacement,
	startBoard,
	type StoredPlacement,
} from './widgets.repository';

export const EVENT_DEBOUNCE_MS = 2_000;
const LOGIN_FRESH_MS = 10 * 60_000;

export type WidgetsDeps = Readonly<{
	checkouts: Pick<RepositoriesPlatform['checkouts'], 'resolveCheckout'>;
	gh: RepositoriesPlatform['gh'];
	runner: SourceDeps['runner'];
	environment: () => Readonly<Record<string, string>>;
	secrets: Pick<SecretsPlatform, 'valuesReaching'>;
	log: (line: string) => void;
	eventDebounceMs?: number;
}>;

export type SavedWidget = Readonly<{
	widget: WidgetDefinition;
	path: string;
	reading: WidgetReading | null;
}>;

type Location = Readonly<{ board: string; repository: string | null; github: boolean }>;

type Opened = Location &
	Readonly<{ workstreamId: string; checkout: string; widgets: readonly WidgetDefinition[] }>;

type Watch = {
	readonly workstreamId: string;
	board: string | null;
	generation: number;
	readonly timers: NodeJS.Timeout[];
	readonly soon: Map<string, NodeJS.Timeout>;
	readonly unsubscribes: Array<() => void>;
};

type WidgetsContext = Pick<MainContext, 'db' | 'events' | 'commands'>;

export class WidgetBoards {
	readonly #context: WidgetsContext;
	readonly #deps: WidgetsDeps;
	readonly #locations = new Map<string, Promise<Location>>();
	readonly #reads = new Map<string, Promise<WidgetReading>>();
	readonly #watches = new Map<string, Watch>();
	readonly #skipped = new Set<string>();
	readonly #unsubscribes: Array<() => void>;
	#me: Readonly<{ login: Promise<string | null>; at: number }> | null = null;

	constructor(context: WidgetsContext, deps: WidgetsDeps) {
		this.#context = context;
		this.#deps = deps;
		this.#unsubscribes = [
			context.events.subscribe('repositories:workstream-files-changed', (changed) => {
				const watch = this.#watches.get(changed.workstreamId);
				if (watch && (changed.paths === null || changed.paths.some(touchesWidgets))) {
					void this.#replanFiles(watch);
				}
			}),
			context.events.subscribe('repositories:workstream-removed', ({ workstreamId }) => {
				this.watch(workstreamId, false);
				this.#locations.delete(workstreamId);
			}),
		];
	}

	async board(workstreamId: string): Promise<WidgetBoard> {
		return this.#snapshot(await this.#open(workstreamId));
	}

	async place(
		workstreamId: string,
		widgetId: string,
		index: number | null,
		size: WidgetSize | null,
	): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		const widget = this.#widget(opened, widgetId);
		const placements = this.#placements(opened);
		const others = placements.filter((placement) => placement.widgetId !== widgetId);
		const current = placements.find((placement) => placement.widgetId === widgetId);
		placeWidget(this.#context.db, opened.board, {
			widgetId,
			before: index === null ? null : (others[index]?.widgetId ?? null),
			size: size ?? current?.size ?? widget.size,
			approvedFingerprint: widget.fingerprint,
		});
		return this.#changed(opened);
	}

	async resize(workstreamId: string, widgetId: string, size: WidgetSize): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		this.#widget(opened, widgetId);
		if (!resizePlacement(this.#context.db, opened.board, widgetId, size)) {
			throw new WidgetError('not-found', `The widget \`${widgetId}\` is not on the board.`);
		}
		return this.#changed(opened);
	}

	async remove(workstreamId: string, widgetId: string): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		removePlacement(this.#context.db, opened.board, widgetId);
		return this.#changed(opened);
	}

	async hide(workstreamId: string, widgetId: string): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		hideWidget(this.#context.db, opened.board, widgetId);
		return this.#changed(opened);
	}

	async refresh(workstreamId: string, widgetId: string): Promise<WidgetReading> {
		const opened = await this.#open(workstreamId);
		const widget = this.#widget(opened, widgetId);
		const placement = listPlacements(this.#context.db, opened.board).find(
			(placed) => placed.widgetId === widgetId,
		);
		if (!runnable(widget, placement ?? null)) return this.#reading(opened.board, widget);
		return this.#read(opened, widget);
	}

	watch(workstreamId: string, watching: boolean): void {
		const watch = this.#watches.get(workstreamId);
		if (!watching) {
			if (!watch) return;
			this.#watches.delete(workstreamId);
			watch.generation += 1;
			clear(watch);
			return;
		}
		if (watch) return;
		const started: Watch = {
			workstreamId,
			board: null,
			generation: 0,
			timers: [],
			soon: new Map(),
			unsubscribes: [],
		};
		this.#watches.set(workstreamId, started);
		void this.#plan(started);
	}

	async save(workstreamId: string, input: unknown): Promise<SavedWidget> {
		if (!isRecord(input)) throw new WidgetError('bad-widget', 'A widget is one JSON object.');
		const checkout = await this.#deps.checkouts.resolveCheckout(workstreamId);
		const id = input['id'] ?? freeWidgetId(checkout, input['title']);
		if (typeof id !== 'string') throw new WidgetError('bad-widget', '`id` must be kebab-case.');
		const author = await this.#login();
		const widget = parseWidgetFile(id, widgetPath(id), { ...input, author });
		const unknown = unknownChannels(input['refresh'], widget);
		if (unknown.length > 0) {
			throw new WidgetError(
				'bad-widget',
				`\`refresh.on\` names channels Malini does not emit: ${unknown.join(', ')}`,
			);
		}
		const path = await writeWidgetFile(checkout, widget);
		const opened = await this.#open(workstreamId);
		this.#replan(opened.board);
		const saved = this.#widget(opened, widget.id);
		const reading = saved.source.kind === 'github' ? await this.#read(opened, saved) : null;
		return { widget: saved, path, reading };
	}

	dispose(): void {
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		for (const workstreamId of [...this.#watches.keys()]) this.watch(workstreamId, false);
	}

	async #open(workstreamId: string): Promise<Opened> {
		if (getWorkstream(this.#context.db, workstreamId) === null) {
			throw new WidgetError('workstream-gone', `The workstream \`${workstreamId}\` is gone.`);
		}
		const checkout = await this.#deps.checkouts.resolveCheckout(workstreamId);
		const location = await this.#locate(workstreamId, checkout);
		const files = await readWidgetFiles(checkout, (path, problem) =>
			this.#skip(checkout, path, problem),
		);
		if (startBoard(this.#context.db, location.board) && location.github) {
			placeWidget(this.#context.db, location.board, {
				widgetId: PLAN_WIDGET_ID,
				before: null,
				size: 'large',
				approvedFingerprint: PLAN_WIDGET.fingerprint,
			});
		}
		return {
			...location,
			workstreamId,
			checkout,
			widgets: location.github ? [PLAN_WIDGET, ...files] : files,
		};
	}

	#locate(workstreamId: string, checkout: string): Promise<Location> {
		const known = this.#locations.get(workstreamId);
		if (known) return known;
		const located = this.#located(workstreamId, checkout);
		this.#locations.set(workstreamId, located);
		return located;
	}

	async #located(workstreamId: string, checkout: string): Promise<Location> {
		const { db } = this.#context;
		const [repository, origin] = await Promise.all([
			workstreamRepositoryName(db, workstreamId),
			readOrigin(checkout),
		]);
		return {
			board: repository ?? `project:${getWorkstream(db, workstreamId)?.projectId ?? workstreamId}`,
			repository,
			github: origin !== null && githubFullNameFromRemote(origin) !== null,
		};
	}

	async #replanFiles(watch: Watch): Promise<void> {
		await this.#plan(watch);
		this.#announce(watch.board);
	}

	#skip(checkout: string, path: string, problem: string): void {
		const key = `${checkout}\n${path}\n${problem}`;
		if (this.#skipped.has(key)) return;
		this.#skipped.add(key);
		this.#deps.log(`widgets: skipped \`${path}\` in \`${checkout}\`: ${problem}`);
	}

	#widget(opened: Opened, widgetId: string): WidgetDefinition {
		const widget = opened.widgets.find((candidate) => candidate.id === widgetId);
		if (!widget) {
			throw new WidgetError('not-found', `No widget \`${widgetId}\` in this workstream.`);
		}
		return widget;
	}

	#placements(opened: Opened): WidgetPlacement[] {
		const byId = new Map(opened.widgets.map((widget) => [widget.id, widget]));
		return listPlacements(this.#context.db, opened.board).flatMap((placement) => {
			const widget = byId.get(placement.widgetId);
			if (!widget) return [];
			const approved =
				widget.source.kind !== 'command' || placement.approvedFingerprint === widget.fingerprint;
			return [{ widgetId: widget.id, size: placement.size, approved }];
		});
	}

	async #snapshot(opened: Opened): Promise<WidgetBoard> {
		const me = this.#login();
		return {
			board: opened.board,
			workstreamId: opened.workstreamId,
			widgets: opened.widgets,
			placements: this.#placements(opened),
			hidden: listHidden(this.#context.db, opened.board),
			readings: opened.widgets.flatMap((widget) => {
				const reading = this.#reading(opened.board, widget);
				return reading.attemptedAt === null && !reading.reading ? [] : [reading];
			}),
			me: await me,
		};
	}

	#changed(opened: Opened): Promise<WidgetBoard> {
		this.#replan(opened.board);
		return this.#snapshot(opened);
	}

	#replan(board: string): void {
		this.#announce(board);
		for (const watch of this.#watches.values()) {
			if (watch.board?.toLowerCase() === board.toLowerCase()) void this.#plan(watch);
		}
	}

	#announce(board: string | null): void {
		if (board !== null) this.#context.events.emit('widgets:board-changed', { board });
	}

	#reading(board: string, widget: WidgetDefinition): WidgetReading {
		const stored = getReading(this.#context.db, board, widget.id);
		return {
			board,
			widgetId: widget.id,
			fingerprint: stored?.fingerprint ?? widget.fingerprint,
			data: stored?.data ?? null,
			readAt: stored?.readAt ?? null,
			error: stored?.error ?? null,
			attemptedAt: stored?.attemptedAt ?? null,
			reading: this.#reads.has(readKey(board, widget.id)),
		};
	}

	#read(opened: Opened, widget: WidgetDefinition): Promise<WidgetReading> {
		const key = readKey(opened.board, widget.id);
		const running = this.#reads.get(key);
		if (running) return running;
		const read = (async () => {
			try {
				await this.#fetch(opened, widget);
			} finally {
				this.#reads.delete(key);
			}
			return this.#emitReading(opened.board, widget);
		})();
		this.#reads.set(key, read);
		this.#emitReading(opened.board, widget);
		return read;
	}

	async #fetch(opened: Opened, widget: WidgetDefinition): Promise<void> {
		const { db } = this.#context;
		const outcome = await readWidgetSource(widget.source, opened.checkout, {
			gh: this.#deps.gh,
			runner: this.#deps.runner,
			environment: () => ({
				...this.#deps.environment(),
				...this.#deps.secrets.valuesReaching(opened.repository),
			}),
		});
		if ('data' in outcome)
			recordRead(db, opened.board, widget.id, widget.fingerprint, outcome.data);
		else recordFailedRead(db, opened.board, widget.id, widget.fingerprint, outcome.error);
	}

	#emitReading(board: string, widget: WidgetDefinition): WidgetReading {
		const reading = this.#reading(board, widget);
		this.#context.events.emit('widgets:reading-changed', reading);
		return reading;
	}

	async #plan(watch: Watch): Promise<void> {
		const generation = (watch.generation += 1);
		let opened: Opened;
		try {
			opened = await this.#open(watch.workstreamId);
		} catch (error) {
			if (error instanceof WidgetError && error.kind === 'workstream-gone') return;
			this.#deps.log(`widgets: not watching \`${watch.workstreamId}\`: ${describeError(error)}`);
			return;
		}
		if (watch.generation !== generation || this.#watches.get(watch.workstreamId) !== watch) return;
		clear(watch);
		watch.board = opened.board;
		const placed = new Map(
			listPlacements(this.#context.db, opened.board).map((placement) => [
				placement.widgetId,
				placement,
			]),
		);
		for (const widget of opened.widgets) {
			const placement = placed.get(widget.id) ?? null;
			if (!runnable(widget, placement)) continue;
			const every = widget.refresh.everySeconds * 1000;
			const last = this.#reading(opened.board, widget);
			const attempted =
				last.fingerprint === widget.fingerprint ? Date.parse(last.attemptedAt ?? '') : Number.NaN;
			const due = Number.isNaN(attempted) ? 0 : Math.max(0, attempted + every - Date.now());
			if (placement === null) {
				if (due === 0) void this.#read(opened, widget);
				continue;
			}
			this.#every(watch, opened, widget, due);
			for (const channel of widget.refresh.on) {
				if (!isEventChannel(channel) || isWidgetChannel(channel)) continue;
				watch.unsubscribes.push(
					this.#context.events.subscribe(channel, () => this.#soon(watch, opened, widget)),
				);
			}
		}
	}

	#every(watch: Watch, opened: Opened, widget: WidgetDefinition, due: number): void {
		const read = (): void => void this.#read(opened, widget);
		const first = setTimeout(() => {
			read();
			const repeat = setInterval(read, widget.refresh.everySeconds * 1000);
			repeat.unref();
			watch.timers.push(repeat);
		}, due);
		first.unref();
		watch.timers.push(first);
	}

	#soon(watch: Watch, opened: Opened, widget: WidgetDefinition): void {
		clearTimeout(watch.soon.get(widget.id));
		const timer = setTimeout(() => {
			watch.soon.delete(widget.id);
			void this.#read(opened, widget);
		}, this.#deps.eventDebounceMs ?? EVENT_DEBOUNCE_MS);
		timer.unref();
		watch.soon.set(widget.id, timer);
	}

	#login(): Promise<string | null> {
		if (this.#me === null || Date.now() - this.#me.at > LOGIN_FRESH_MS) {
			this.#me = { at: Date.now(), login: this.#signedIn() };
		}
		return this.#me.login;
	}

	async #signedIn(): Promise<string | null> {
		try {
			const status = await this.#context.commands.call(
				'repositories.github-auth-status',
				undefined,
			);
			return status.authenticated && isGithubLogin(status.login) ? status.login : null;
		} catch {
			return null;
		}
	}
}

function runnable(widget: WidgetDefinition, placement: StoredPlacement | null): boolean {
	if (widget.source.kind === 'github') return true;
	if (widget.source.kind === 'plan') return false;
	return placement !== null && placement.approvedFingerprint === widget.fingerprint;
}

function clear(watch: Watch): void {
	for (const timer of watch.timers.splice(0)) clearTimeout(timer);
	for (const timer of watch.soon.values()) clearTimeout(timer);
	watch.soon.clear();
	for (const unsubscribe of watch.unsubscribes.splice(0)) unsubscribe();
}

function readKey(board: string, widgetId: string): string {
	return `${board.toLowerCase()}\n${widgetId}`;
}

function touchesWidgets(path: string): boolean {
	return path === '.malini' || path === WIDGETS_FOLDER || path.startsWith(`${WIDGETS_FOLDER}/`);
}

function unknownChannels(refresh: unknown, widget: WidgetDefinition): string[] {
	const asked = isRecord(refresh) && Array.isArray(refresh['on']) ? refresh['on'] : [];
	return asked.filter(
		(channel): channel is string =>
			typeof channel === 'string' && !widget.refresh.on.includes(channel),
	);
}
