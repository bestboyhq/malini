import { isEventChannel } from '$contract/events';
import {
	PLAN_WIDGET_ID,
	PLAN_WIDGET_SPAN,
	WIDGET_DEFAULT_SPAN,
	widgetSite,
	type WidgetBoard,
	type WidgetDefinition,
	type WidgetNeed,
	type WidgetPlacement,
	type WidgetReading,
	type WidgetSource,
	type WidgetSpan,
} from '$contract/widgets';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { isRecord } from '$main/db/rows';
import {
	getProject,
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
} from './widget-files';
import {
	covers,
	findSignIn,
	isFresh,
	parseGrant,
	refreshGrant,
	signIn,
	type Grant,
} from './widget-oauth';
import { readWidgetSource, type SourceDeps, type SourceOutcome } from './widget-sources';
import {
	copyWidgetFile,
	deleteMine,
	materializeShared,
	mineHome,
	readMine,
	sharedTree,
	storeRoot,
	writeMine,
	type SharedBase,
} from './widget-store';
import {
	deleteConnection,
	forgetReading,
	getConnection,
	getReading,
	listPlacements,
	placeWidget,
	recordFailedRead,
	recordRead,
	removePlacement,
	resizePlacement,
	saveConnection,
	startBoard,
} from './widgets.repository';

export const EVENT_DEBOUNCE_MS = 2_000;
export const SHARED_CHECK_MS = 60_000;
const LOGIN_FRESH_MS = 10 * 60_000;
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export type WidgetsDeps = Readonly<{
	checkouts: Pick<RepositoriesPlatform['checkouts'], 'resolveCheckout'>;
	gh: RepositoriesPlatform['gh'];
	runner: SourceDeps['runner'];
	environment: () => Readonly<Record<string, string>>;
	fetch: SourceDeps['fetch'];
	openExternal: (url: string) => Promise<void>;
	sealer: Readonly<{
		isEncryptionAvailable(): boolean;
		encryptString(plainText: string): Buffer;
		decryptString(encrypted: Buffer): string;
	}>;
	log: (line: string) => void;
	eventDebounceMs?: number;
	sharedCheckMs?: number;
}>;

export type SavedWidget = Readonly<{ widget: WidgetDefinition; reading: WidgetReading }>;

type Location = Readonly<{ board: string; repository: string | null; github: boolean }>;

type HttpSource = Extract<WidgetSource, { kind: 'http' }>;

type Unread = Readonly<{ error: string; need: WidgetNeed | null }>;

type Token = Readonly<{ token: string | null }> | Unread;

type Connecting = Readonly<{ origin: string; controller: AbortController; done: Promise<void> }>;

type Opened = Location &
	Readonly<{
		workstreamId: string;
		checkout: string;
		root: string;
		base: SharedBase | null;
		tree: string | null;
		widgets: readonly WidgetDefinition[];
		homes: ReadonlyMap<string, string>;
	}>;

type Watch = {
	readonly workstreamId: string;
	board: string | null;
	tree: string | null;
	stale: boolean;
	generation: number;
	readonly timers: NodeJS.Timeout[];
	readonly soon: Map<string, NodeJS.Timeout>;
	readonly unsubscribes: Array<() => void>;
};

type WidgetsContext = Pick<MainContext, 'db' | 'events' | 'commands' | 'appDataRoot'>;

export class WidgetBoards {
	readonly #context: WidgetsContext;
	readonly #deps: WidgetsDeps;
	readonly #locations = new Map<string, Promise<Location>>();
	readonly #reads = new Map<string, Promise<WidgetReading>>();
	readonly #shared = new Map<string, Promise<string>>();
	readonly #watches = new Map<string, Watch>();
	readonly #skipped = new Set<string>();
	readonly #renewing = new Map<string, Promise<Grant>>();
	#connecting: Connecting | null = null;
	readonly #unsubscribes: Array<() => void>;
	#writes: Promise<unknown> = Promise.resolve();
	#me: Readonly<{ login: Promise<string | null>; at: number }> | null = null;

	constructor(context: WidgetsContext, deps: WidgetsDeps) {
		this.#context = context;
		this.#deps = deps;
		this.#unsubscribes = [
			context.events.subscribe('repositories:workstream-removed', ({ workstreamId }) => {
				this.watch(workstreamId, false);
				this.#locations.delete(workstreamId);
			}),
		];
	}

	async board(workstreamId: string): Promise<WidgetBoard> {
		return this.#snapshot(await this.#open(workstreamId));
	}

	async place(workstreamId: string, widgetId: string, index: number): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		const widget = this.#widget(opened, widgetId);
		const placements = this.#placements(opened);
		const others = placements.filter((placement) => placement.widgetId !== widgetId);
		const current = placements.find((placement) => placement.widgetId === widgetId);
		placeWidget(this.#context.db, opened.board, {
			widgetId,
			before: others[index]?.widgetId ?? null,
			span: current?.span ?? firstSpan(widget),
		});
		return this.#changed(opened);
	}

	async resize(workstreamId: string, widgetId: string, span: WidgetSpan): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		this.#widget(opened, widgetId);
		if (!resizePlacement(this.#context.db, opened.board, widgetId, span)) {
			throw new WidgetError('not-found', `The widget \`${widgetId}\` is not on the board.`);
		}
		return this.#changed(opened);
	}

	pinPlan(repositoryFullName: string): void {
		const { db } = this.#context;
		startBoard(db, repositoryFullName);
		const placed = listPlacements(db, repositoryFullName);
		if (placed.some(({ widgetId }) => widgetId === PLAN_WIDGET_ID)) return;
		placeWidget(db, repositoryFullName, {
			widgetId: PLAN_WIDGET_ID,
			before: placed[0]?.widgetId ?? null,
			span: PLAN_WIDGET_SPAN,
		});
		this.#replan(repositoryFullName);
	}

	async remove(workstreamId: string, widgetId: string): Promise<WidgetBoard> {
		const opened = await this.#open(workstreamId);
		const { db } = this.#context;
		removePlacement(db, opened.board, widgetId);
		if (!opened.widgets.some(({ id, origin }) => id === widgetId && origin === 'mine')) {
			return this.#changed(opened);
		}
		await this.#write(() => deleteMine(opened.root, widgetId));
		forgetReading(db, opened.board, widgetId);
		return this.#changed(await this.#open(workstreamId));
	}

	async share(workstreamId: string, widgetId: string): Promise<void> {
		const opened = await this.#open(workstreamId);
		const home = opened.homes.get(widgetId);
		if (this.#widget(opened, widgetId).origin !== 'mine' || home === undefined) {
			throw new WidgetError('shared-widget', `\`${widgetId}\` is already in this repository.`);
		}
		await copyWidgetFile(home, widgetId, opened.checkout);
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
			tree: null,
			stale: false,
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
		const opened = await this.#open(workstreamId);
		const taken = new Set(opened.widgets.map((widget) => widget.id));
		const id = input['id'] ?? freeWidgetId(taken, input['title']);
		if (typeof id !== 'string') throw new WidgetError('bad-widget', '`id` must be kebab-case.');
		if (opened.widgets.some((widget) => widget.id === id && widget.origin === 'shared')) {
			throw new WidgetError(
				'shared-widget',
				`\`${id}\` is shared from the default branch. Change \`${widgetPath(id)}\` in this checkout and open a pull request, or save it under another id.`,
			);
		}
		const widget = parseWidgetFile(id, { ...input, author: await this.#login() }, 'mine');
		if (widget.source.kind === 'retired') {
			throw new WidgetError(
				'bad-widget',
				'Widgets read APIs, not scripts or MCP tools. Give `source.http` with the `url` of a request that only reads, or `source.github`.',
			);
		}
		if (widget.source.kind === 'http' && widget.source.oauth !== null) {
			await findSignIn(widget.source.url, this.#deps.fetch).catch((error: unknown) => {
				throw new WidgetError(
					'bad-widget',
					`${describeError(error)} Drop \`oauth\`, or read an API that signs in with OAuth.`,
				);
			});
		}
		const unknown = unknownChannels(input['refresh'], widget);
		if (unknown.length > 0) {
			throw new WidgetError(
				'bad-widget',
				`\`refresh.on\` names channels Malini does not emit: ${unknown.join(', ')}`,
			);
		}
		await this.#write(() => writeMine(opened.root, widget));
		const { db } = this.#context;
		const placed = listPlacements(db, opened.board);
		if (!placed.some((placement) => placement.widgetId === id)) {
			placeWidget(db, opened.board, {
				widgetId: id,
				before: placed[0]?.widgetId ?? null,
				span: WIDGET_DEFAULT_SPAN,
			});
		}
		const saved = await this.#open(workstreamId);
		this.#replan(saved.board);
		const reading = await this.#read(saved, this.#widget(saved, id));
		return { widget: this.#widget(saved, id), reading };
	}

	async connect(workstreamId: string, widgetId: string): Promise<void> {
		const opened = await this.#open(workstreamId);
		const widget = this.#widget(opened, widgetId);
		const { source } = widget;
		if (source.kind !== 'http' || source.oauth === null) {
			throw new WidgetError('bad-widget', `\`${widgetId}\` signs in nowhere.`);
		}
		const { origin } = new URL(source.url);
		if (this.#connecting?.origin === origin) return this.#connecting.done;
		this.#connecting?.controller.abort();
		const controller = new AbortController();
		const connecting: Connecting = {
			origin,
			controller,
			done: this.#signIn(opened, widget, source, controller.signal),
		};
		this.#connecting = connecting;
		try {
			return await connecting.done;
		} finally {
			if (this.#connecting === connecting) this.#connecting = null;
		}
	}

	cancelConnect(): void {
		this.#connecting?.controller.abort();
	}

	async #signIn(
		opened: Opened,
		widget: WidgetDefinition,
		source: HttpSource,
		signal: AbortSignal,
	): Promise<void> {
		const { origin } = new URL(source.url);
		const scopes = [...(this.#grant(origin)?.scopes ?? []), ...(source.oauth?.scopes ?? [])];
		try {
			const grant = await signIn(
				source.url,
				[...new Set(scopes)],
				this.#deps,
				AbortSignal.any([signal, AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)]),
			);
			this.#saveGrant(origin, grant);
		} catch (error) {
			if (error instanceof WidgetError && error.kind === 'sign-in-cancelled') return;
			const need =
				error instanceof WidgetError && error.kind === 'no-sign-in'
					? null
					: { connect: widgetSite(source.url) };
			recordFailedRead(this.#context.db, opened.board, widget.id, widget.fingerprint, {
				error: describeError(error),
				need,
			});
			this.#emitReading(opened.board, widget);
			return;
		}
		const watched = await Promise.all(
			[...this.#watches.keys()].map((id) => this.#open(id).catch(() => null)),
		);
		void this.#read(opened, widget);
		for (const board of watched) {
			for (const each of board?.widgets ?? []) {
				if (board !== null && signsInAt(each.source, origin)) void this.#read(board, each);
			}
		}
	}

	dispose(): void {
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		for (const workstreamId of [...this.#watches.keys()]) this.watch(workstreamId, false);
	}

	async #open(workstreamId: string): Promise<Opened> {
		const { db } = this.#context;
		const workstream = getWorkstream(db, workstreamId);
		if (workstream === null) {
			throw new WidgetError('workstream-gone', `The workstream \`${workstreamId}\` is gone.`);
		}
		const checkout = await this.#deps.checkouts.resolveCheckout(workstreamId);
		const location = await this.#locate(workstreamId, checkout);
		if (startBoard(db, location.board) && location.github) {
			placeWidget(db, location.board, {
				widgetId: PLAN_WIDGET_ID,
				before: null,
				span: PLAN_WIDGET_SPAN,
			});
		}
		const root = storeRoot(this.#context.appDataRoot, location.board);
		const project = getProject(db, workstream.projectId);
		const base = project ? { repoPath: project.repoPath, branch: project.defaultBranch } : null;
		const tree = base === null ? null : await sharedTree(base);
		const home = base === null || tree === null ? null : await this.#materialize(root, base, tree);
		const skip = (path: string, problem: string): void => this.#skip(path, problem);
		const shared = home === null ? [] : await readWidgetFiles(home, 'shared', skip);
		const sharedIds = new Set(shared.map(({ id }) => id));
		let mine = await readMine(root, skip);
		if (await this.#adopt(location.board, root, checkout, [...shared, ...mine])) {
			mine = await readMine(root, skip);
		}
		const own = mine.filter(({ id }) => !sharedIds.has(id));
		const homes = new Map(own.map(({ id }) => [id, mineHome(root, id)]));
		return {
			...location,
			workstreamId,
			checkout,
			root,
			base,
			tree,
			widgets: [...(location.github ? [PLAN_WIDGET] : []), ...shared, ...own],
			homes,
		};
	}

	async #adopt(
		board: string,
		root: string,
		checkout: string,
		known: readonly WidgetDefinition[],
	): Promise<boolean> {
		const ids = new Set([PLAN_WIDGET_ID, ...known.map(({ id }) => id)]);
		const missing = new Set(
			listPlacements(this.#context.db, board)
				.map(({ widgetId }) => widgetId)
				.filter((id) => !ids.has(id)),
		);
		if (missing.size === 0) return false;
		const files = await readWidgetFiles(checkout, 'mine', () => undefined);
		const found = files.filter(({ id, source }) => missing.has(id) && source.kind !== 'retired');
		for (const widget of found) await this.#write(() => writeMine(root, widget));
		return found.length > 0;
	}

	#materialize(root: string, base: SharedBase, tree: string): Promise<string> {
		const key = `${root}\n${tree}`;
		const running = this.#shared.get(key);
		if (running) return running;
		const materializing = materializeShared(root, base, tree).finally(() =>
			this.#shared.delete(key),
		);
		this.#shared.set(key, materializing);
		return materializing;
	}

	#write(change: () => Promise<void>): Promise<void> {
		const before = this.#writes;
		const written = (async () => {
			await before;
			await change();
		})();
		this.#writes = written.catch(() => undefined);
		return written;
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

	#skip(path: string, problem: string): void {
		const key = `${path}\n${problem}`;
		if (this.#skipped.has(key)) return;
		this.#skipped.add(key);
		this.#deps.log(`widgets: skipped \`${path}\`: ${problem}`);
	}

	#widget(opened: Opened, widgetId: string): WidgetDefinition {
		const widget = opened.widgets.find((candidate) => candidate.id === widgetId);
		if (!widget) {
			throw new WidgetError('not-found', `No widget \`${widgetId}\` on this board.`);
		}
		return widget;
	}

	#placements(opened: Opened): WidgetPlacement[] {
		const ids = new Set(opened.widgets.map(({ id }) => id));
		return listPlacements(this.#context.db, opened.board).filter(({ widgetId }) =>
			ids.has(widgetId),
		);
	}

	async #snapshot(opened: Opened): Promise<WidgetBoard> {
		const me = this.#login();
		return {
			board: opened.board,
			workstreamId: opened.workstreamId,
			widgets: opened.widgets,
			repository: opened.repository,
			placements: this.#placements(opened),
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
		this.#context.events.emit('widgets:board-changed', { board });
		for (const watch of this.#watches.values()) {
			if (watch.board?.toLowerCase() === board.toLowerCase()) void this.#plan(watch);
		}
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
			need: stored?.need ?? null,
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
		const { source } = widget;
		const read = async (token: Token): Promise<SourceOutcome | Unread> =>
			'need' in token ? token : readWidgetSource(source, opened.checkout, this.#deps, token.token);
		let token = source.kind === 'http' ? await this.#token(source, null) : { token: null };
		let outcome = await read(token);
		if (source.kind === 'http' && 'refused' in outcome && outcome.refused && 'token' in token) {
			token = await this.#token(source, token.token);
			outcome = await read(token);
		}
		if ('data' in outcome) {
			recordRead(db, opened.board, widget.id, widget.fingerprint, outcome.data);
			return;
		}
		if (source.kind === 'retired') forgetReading(db, opened.board, widget.id);
		recordFailedRead(db, opened.board, widget.id, widget.fingerprint, {
			error: outcome.error,
			need: 'need' in outcome ? outcome.need : null,
		});
	}

	async #token(source: HttpSource, refused: string | null): Promise<Token> {
		if (source.oauth === null) return { token: null };
		const { origin } = new URL(source.url);
		const site = widgetSite(source.url);
		const need = { connect: site };
		const grant = this.#grant(origin);
		if (grant === null) return { need, error: `Reads ${site} as you.` };
		const missing = source.oauth.scopes.filter((scope) => !covers(grant, [scope]));
		if (missing.length > 0) return { need, error: `Needs ${listed(missing)} on ${site}.` };
		if (isFresh(grant) && grant.accessToken !== refused) return { token: grant.accessToken };
		try {
			return { token: (await this.#renew(origin, site, grant)).accessToken };
		} catch (error) {
			if (!(error instanceof WidgetError && error.kind === 'signed-out')) {
				return { need: null, error: describeError(error) };
			}
			if (this.#grant(origin)?.accessToken === grant.accessToken) {
				deleteConnection(this.#context.db, origin);
			}
			return { need, error: error.message };
		}
	}

	#renew(origin: string, site: string, grant: Grant): Promise<Grant> {
		const running = this.#renewing.get(origin);
		if (running) return running;
		const renewing = (async () => {
			try {
				const renewed = await refreshGrant(grant, site, this.#deps.fetch);
				this.#saveGrant(origin, renewed);
				return renewed;
			} finally {
				this.#renewing.delete(origin);
			}
		})();
		this.#renewing.set(origin, renewing);
		return renewing;
	}

	#grant(origin: string): Grant | null {
		const { sealer } = this.#deps;
		const sealed = getConnection(this.#context.db, origin);
		if (sealed === null || !sealer.isEncryptionAvailable()) return null;
		try {
			return parseGrant(JSON.parse(sealer.decryptString(Buffer.from(sealed))));
		} catch {
			return null;
		}
	}

	#connected(source: WidgetSource): boolean {
		if (source.kind !== 'http' || source.oauth === null) return false;
		const grant = this.#grant(new URL(source.url).origin);
		return grant !== null && covers(grant, source.oauth.scopes);
	}

	#saveGrant(origin: string, grant: Grant): void {
		const { sealer } = this.#deps;
		if (!sealer.isEncryptionAvailable()) {
			throw new WidgetError(
				'sign-in-failed',
				'Malini cannot reach the macOS keychain to keep the sign-in. Unlock it, then connect again.',
			);
		}
		saveConnection(this.#context.db, origin, sealer.encryptString(JSON.stringify(grant)));
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
		const moved = watch.stale || (watch.board !== null && watch.tree !== opened.tree);
		watch.stale = false;
		clear(watch);
		watch.board = opened.board;
		watch.tree = opened.tree;
		const placed = new Set(this.#placements(opened).map(({ widgetId }) => widgetId));
		for (const widget of opened.widgets) {
			if (widget.source.kind === 'plan' || !placed.has(widget.id)) continue;
			const every = widget.refresh.everySeconds * 1000;
			const last = this.#reading(opened.board, widget);
			const attempted =
				last.fingerprint === widget.fingerprint ? Date.parse(last.attemptedAt ?? '') : Number.NaN;
			const fresh =
				Number.isNaN(attempted) ||
				(last.need !== null && !last.reading && this.#connected(widget.source)) ||
				(moved && widget.origin === 'shared') ||
				widget.source.kind === 'retired';
			const due = fresh ? 0 : Math.max(0, attempted + every - Date.now());
			this.#every(watch, opened, widget, due);
			for (const channel of widget.refresh.on) {
				if (!isEventChannel(channel) || isWidgetChannel(channel)) continue;
				watch.unsubscribes.push(
					this.#context.events.subscribe(channel, () => this.#soon(watch, opened, widget)),
				);
			}
		}
		const check = setInterval(
			() => void this.#checkShared(watch, opened).catch(() => undefined),
			this.#deps.sharedCheckMs ?? SHARED_CHECK_MS,
		);
		check.unref();
		watch.timers.push(check);
	}

	async #checkShared(watch: Watch, opened: Opened): Promise<void> {
		if (opened.base === null) return;
		const tree = await sharedTree(opened.base);
		if (tree === watch.tree) return;
		watch.tree = tree;
		watch.stale = true;
		this.#replan(opened.board);
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

function signsInAt(source: WidgetSource, origin: string): boolean {
	return source.kind === 'http' && source.oauth !== null && new URL(source.url).origin === origin;
}

function listed(names: readonly string[]): string {
	return new Intl.ListFormat('en-US', { type: 'conjunction' }).format(names);
}

function firstSpan(widget: WidgetDefinition): WidgetSpan {
	return widget.origin === 'plan' ? PLAN_WIDGET_SPAN : WIDGET_DEFAULT_SPAN;
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

function unknownChannels(refresh: unknown, widget: WidgetDefinition): string[] {
	const asked = isRecord(refresh) && Array.isArray(refresh['on']) ? refresh['on'] : [];
	return asked.filter(
		(channel): channel is string =>
			typeof channel === 'string' && !widget.refresh.on.includes(channel),
	);
}
