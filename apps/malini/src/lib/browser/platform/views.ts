import type { AgentRunProfile } from '$contract/agent';
import type {
	BrowserBounds,
	BrowserElementPrompt,
	BrowserPickArgs,
	BrowserResizeRequest,
	BrowserState,
	BrowserTabArgs,
	BrowserThreadStarted,
} from '$contract/browser';
import type {
	BrowserConsole,
	BrowserConsoleLine,
	BrowserPageInfo,
	BrowserPlatform,
	BrowserScreenshotFile,
	BrowserScreenshotPart,
	BrowserScrollPosition,
	BrowserSize,
	BrowserTabProcess,
	BrowserWait,
} from '../browser.platform';
import {
	captureFrame,
	captureRegion,
	captureVisible,
	clickTarget,
	evaluateScript,
	hoverTarget,
	openUrl,
	pageLoaded,
	pressKey,
	readPage,
	saveScreenshot,
	scrollPage,
	settleAfterAction,
	typeInto,
	untilSized,
	waitFor,
	within,
} from './automation';
import type { HostWindow, PageContents, PageEvents, PageImage, PageView, Rectangle } from './page';
import { pickElement, pickerPage, untilAborted } from './picker';
import {
	pinsOnPage,
	pinsPage,
	readPinAction,
	type PinAction,
	type PinsPage,
	type ThreadPin,
} from './thread-pins';
import { isFileAddress, normalizeBrowserUrl, worktreeFileUrl } from './url';

export const DEFAULT_VIEW_SIZE = { width: 1_280, height: 800 } as const;
export const CORNER_RADIUS = 16;
export const NOTHING_OPEN = 'Nothing is open in the browser yet. Call browser_open first.';
export const RESIZE_ANSWER_MS = 5_000;
export const MAX_CONSOLE_LINES = 200;
export const MAX_CONSOLE_TEXT = 1_000;
const PICK_WITHOUT_PAGE = 'Open a page before picking an element.';

export interface BrowserViewsDeps<W extends HostWindow> {
	getMainWindow(): W | null;
	onScreen(window: W): boolean;
	createView(events: PageEvents): PageView<W>;
	imageFromPng(png: Buffer): PageImage;
	watchRendererReset(window: W, reset: () => void): void;
	workstreamExists(workstreamId: string): boolean;
	worktree(workstreamId: string): string;
	stateChanged(state: BrowserState): void;
	tabOpened(tab: BrowserTabArgs): void;
	tabClosed(tab: BrowserTabArgs): void;
	resizeRequested(request: BrowserResizeRequest): void;
	threads(workstreamId: string): readonly ThreadPin[];
	startThread(
		tab: BrowserTabArgs,
		picked: BrowserElementPrompt,
		profile: AgentRunProfile,
	): Promise<string>;
	threadAction(tab: BrowserTabArgs, action: PinAction): Promise<void>;
}

interface OpenPick {
	readonly controller: AbortController;
	readonly done: Promise<unknown>;
}

interface Entry<W extends HostWindow> {
	readonly tab: BrowserTabArgs;
	readonly view: PageView<W>;
	favicon: string | null;
	window: W | null;
	alive: boolean;
	shown: boolean;
	bounds: Rectangle;
	lastUrl: string;
	failure: string | null;
	pending: string | null;
	pick: OpenPick | null;
	pinActions: AbortController | null;
	consoleLines: BrowserConsoleLine[];
	consoleDropped: number;
}

export class BrowserViews<W extends HostWindow> implements BrowserPlatform {
	private readonly entries = new Map<string, Entry<W>>();
	private readonly watchedWindows = new WeakSet<W>();
	private readonly turns = new Map<string, Promise<unknown>>();
	private readonly resizes = new Map<string, () => void>();
	private resizeCount = 0;

	constructor(private readonly deps: BrowserViewsDeps<W>) {}

	show(tab: BrowserTabArgs, bounds: BrowserBounds): void {
		const entry = this.ensure(tab);
		const window = entry.window;
		if (!window || window.isDestroyed()) return;
		const zoom = window.webContents.getZoomFactor();
		entry.bounds = toDip(bounds, zoom);
		entry.view.setBounds(entry.bounds);
		entry.view.setBorderRadius(Math.round(CORNER_RADIUS * zoom));
		if (!entry.shown) entry.view.placeIn(window, 'front');
		entry.shown = true;
	}

	hide(tab: BrowserTabArgs): void {
		const entry = this.entries.get(tabKey(tab));
		if (!entry?.alive || !entry.window || entry.window.isDestroyed()) return;
		entry.shown = false;
		entry.view.placeIn(entry.window, 'back');
	}

	navigate(tab: BrowserTabArgs, url: string): void {
		const address = this.address(tab, url);
		this.load(this.ensure(tab), address);
	}

	goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const contents = this.page(tab);
			if (!contents.navigationHistory.canGoBack()) {
				throw new Error('There is no page to go back to.');
			}
			contents.navigationHistory.goBack();
			return settledPage(contents);
		});
	}

	goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const contents = this.page(tab);
			if (!contents.navigationHistory.canGoForward()) {
				throw new Error('There is no page to go forward to.');
			}
			contents.navigationHistory.goForward();
			return settledPage(contents);
		});
	}

	reload(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const contents = this.page(tab);
			contents.reload();
			return settledPage(contents);
		});
	}

	tabProcesses(): BrowserTabProcess[] {
		return [...this.entries.values()]
			.filter((entry) => entry.alive && !entry.view.contents.isDestroyed())
			.map(({ view: { contents }, shown }) => ({
				processId: contents.getOSProcessId(),
				title: contents.getTitle() || contents.getURL(),
				shown,
			}));
	}

	state(tab: BrowserTabArgs): BrowserState {
		const entry = this.entries.get(tabKey(tab));
		if (entry?.alive) return stateOf(entry);
		return {
			...tab,
			url: entry?.lastUrl ?? '',
			title: '',
			favicon: null,
			loading: false,
			canGoBack: false,
			canGoForward: false,
			failure: null,
		};
	}

	async snapshot(tab: BrowserTabArgs): Promise<string | null> {
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) return null;
		const image = await this.rendered(entry, () => captureFrame(contents));
		return image && `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
	}

	cover(tab: BrowserTabArgs): Promise<string | null> {
		const snapshot = this.snapshot(tab);
		this.hide(tab);
		return snapshot;
	}

	async pick(args: BrowserPickArgs): Promise<BrowserThreadStarted | null> {
		const tab = { workstreamId: args.workstreamId, tabId: args.tabId };
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!entry || (!contents && !entry.view.contents.isLoading())) {
			throw new Error(PICK_WITHOUT_PAGE);
		}
		const previous = entry.pick;
		const controller = new AbortController();
		const picking = (async () => {
			await previous?.done;
			return this.pickOnceLoaded(entry, controller.signal, args);
		})();
		const pick: OpenPick = { controller, done: picking.catch(() => null) };
		entry.pick = pick;
		previous?.controller.abort();
		try {
			return await picking;
		} finally {
			if (entry.pick === pick) {
				entry.pick = null;
				this.returnFocus(entry);
				this.showPins(entry);
			}
		}
	}

	showThreads(workstreamId: string): void {
		for (const entry of this.entries.values()) {
			if (entry.tab.workstreamId === workstreamId) this.showPins(entry);
		}
	}

	cancelPick(tab: BrowserTabArgs): void {
		this.entries.get(tabKey(tab))?.pick?.controller.abort();
	}

	destroy(tab: BrowserTabArgs): void {
		const entry = this.entries.get(tabKey(tab));
		if (!entry) return;
		this.entries.delete(tabKey(tab));
		this.dispose(entry);
	}

	destroyWorkstream(workstreamId: string): void {
		for (const entry of [...this.entries.values()]) {
			if (entry.tab.workstreamId === workstreamId) this.destroy(entry.tab);
		}
	}

	open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const address = this.address(tab, url);
			const fresh = this.openContents(tab) === null;
			const { contents } = this.ensure(tab).view;
			contents.setBackgroundThrottling(false);
			const opening = openUrl(contents, address);
			if (fresh) this.deps.tabOpened({ workstreamId: tab.workstreamId, tabId: tab.tabId });
			await opening;
			return pageInfo(contents);
		});
	}

	readPage(tab: BrowserTabArgs): Promise<string> {
		return this.inTurn(tab, async () => readPage(this.loaded(tab).contents));
	}

	screenshot(
		tab: BrowserTabArgs,
		worktree: string,
		part: BrowserScreenshotPart,
	): Promise<BrowserScreenshotFile> {
		return this.inTurn(tab, async () => {
			const { contents, entry } = this.loaded(tab);
			return this.rendered(entry, async () => {
				const now = new Date();
				if (part.selector === undefined && !part.fullPage) {
					return saveScreenshot(await captureVisible(contents), contents.getURL(), worktree, now);
				}
				const { png, pageHeight } = await captureRegion(contents, part);
				const image = this.deps.imageFromPng(png);
				const file = await saveScreenshot(image, contents.getURL(), worktree, now);
				return pageHeight === undefined ? file : { ...file, pageHeight };
			});
		});
	}

	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo> {
		return this.act(tab, (contents) => clickTarget(contents, selector));
	}

	hover(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo> {
		return this.act(tab, (contents) => hoverTarget(contents, selector));
	}

	press(tab: BrowserTabArgs, key: string): Promise<BrowserPageInfo> {
		return this.act(tab, (contents) => pressKey(contents, key));
	}

	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const { contents } = this.loaded(tab);
			await typeInto(contents, selector, text, submit);
			return pageInfo(contents);
		});
	}

	scroll(
		tab: BrowserTabArgs,
		by: { readonly x: number; readonly y: number; readonly selector?: string },
	): Promise<BrowserScrollPosition> {
		return this.inTurn(tab, async () => {
			const { contents, entry } = this.loaded(tab);
			return this.rendered(entry, () => scrollPage(contents, by));
		});
	}

	wait(tab: BrowserTabArgs, until: BrowserWait): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const { contents } = this.loaded(tab);
			await waitFor(contents, until);
			return pageInfo(contents);
		});
	}

	evaluate(tab: BrowserTabArgs, script: string): Promise<string> {
		return this.inTurn(tab, async () => evaluateScript(this.loaded(tab).contents, script));
	}

	consoleLines(tab: BrowserTabArgs): Promise<BrowserConsole> {
		return this.inTurn(tab, async () => {
			const contents = this.page(tab);
			const entry = this.entries.get(tabKey(tab));
			return {
				url: contents.getURL(),
				lines: [...(entry?.consoleLines ?? [])],
				dropped: entry?.consoleDropped ?? 0,
			};
		});
	}

	resize(tab: BrowserTabArgs, width: number, height?: number): Promise<BrowserSize> {
		return this.inTurn(tab, async () => {
			const { contents, entry } = this.loaded(tab);
			const window = entry.window;
			if (!entry.shown || !window || window.isDestroyed()) {
				const asked = { width, height: height ?? entry.bounds.height };
				entry.bounds = { ...entry.bounds, ...asked };
				entry.view.setBounds(entry.bounds);
				entry.view.setVisible(true);
				try {
					const size = await untilSized(contents, asked);
					if (size.width === asked.width && size.height === asked.height) return size;
					throw new Error(
						`The page stayed ${size.width} by ${size.height}px instead of ${asked.width} by ${asked.height}px. Call browser_resize again.`,
					);
				} finally {
					if (!entry.shown) entry.view.setVisible(false);
				}
			}
			if (!this.deps.onScreen(window)) {
				throw new Error(
					`Malini's window is minimized or hidden while the user has the browser tab open, so its size did not change: the page is ${entry.bounds.width}px wide.`,
				);
			}
			this.resizeCount += 1;
			const requestId = String(this.resizeCount);
			const answered = new Promise<true>((resolve) =>
				this.resizes.set(requestId, () => resolve(true)),
			);
			const zoom = window.webContents.getZoomFactor();
			this.deps.resizeRequested({ ...tab, requestId, width: width / zoom });
			try {
				if (!(await within(answered, RESIZE_ANSWER_MS))) {
					throw new Error(
						`Malini did not resize the browser tab within ${RESIZE_ANSWER_MS / 1_000}s. Call browser_resize again.`,
					);
				}
			} finally {
				this.resizes.delete(requestId);
			}
			return { width: entry.bounds.width, height: entry.bounds.height };
		});
	}

	resized(requestId: string): void {
		this.resizes.get(requestId)?.();
	}

	close(tab: BrowserTabArgs): Promise<boolean> {
		return this.inTurn(tab, async () => {
			const wasOpen = this.entries.has(tabKey(tab));
			this.destroy(tab);
			this.deps.tabClosed({ workstreamId: tab.workstreamId, tabId: tab.tabId });
			return wasOpen;
		});
	}

	private async pickOnceLoaded(
		entry: Entry<W>,
		signal: AbortSignal,
		args: BrowserPickArgs,
	): Promise<BrowserThreadStarted | null> {
		await untilAborted(pageLoaded(entry.view.contents), signal);
		if (signal.aborted || entry.failure !== null) return null;
		const contents = this.openContents(entry.tab);
		if (!contents) throw new Error(PICK_WITHOUT_PAGE);
		if (entry.window?.isFocused()) contents.focus();
		return pickElement(
			pickerPage(contents),
			signal,
			{ provider: args.provider, model: args.model, models: args.models },
			(picked) => this.deps.startThread(entry.tab, picked, args.profile),
		);
	}

	private act(
		tab: BrowserTabArgs,
		action: (contents: PageContents) => Promise<void>,
	): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const { contents, entry } = this.loaded(tab);
			await this.rendered(entry, () => action(contents));
			return pageInfo(contents);
		});
	}

	private inTurn<T>(tab: BrowserTabArgs, work: () => Promise<T>): Promise<T> {
		const key = tabKey(tab);
		const previous = this.turns.get(key);
		const turn = (async (): Promise<T> => {
			await previous;
			return work();
		})();
		const done = turn.catch(() => undefined);
		this.turns.set(key, done);
		void (async () => {
			await done;
			if (this.turns.get(key) === done) this.turns.delete(key);
		})();
		return turn;
	}

	private async rendered<T>(entry: Entry<W>, capture: () => Promise<T>): Promise<T> {
		const window = entry.window;
		if (!window || window.isDestroyed() || (entry.shown && this.deps.onScreen(window)))
			return capture();
		entry.view.removeFrom(window);
		entry.view.setVisible(true);
		try {
			return await capture();
		} finally {
			if (entry.alive && entry.window && !entry.window.isDestroyed()) {
				entry.view.placeIn(entry.window, entry.shown ? 'front' : 'back');
			}
		}
	}

	private address(tab: BrowserTabArgs, input: string): string {
		return isFileAddress(input)
			? worktreeFileUrl(input, tab.workstreamId, this.deps.worktree(tab.workstreamId))
			: normalizeBrowserUrl(input);
	}

	private loaded(tab: BrowserTabArgs): { contents: PageContents; entry: Entry<W> } {
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) throw new Error(NOTHING_OPEN);
		if (entry.failure !== null) {
			throw new Error(
				`${contents.getURL()} did not load (${entry.failure}). Fix it, then call browser_reload or browser_open.`,
			);
		}
		return { contents, entry };
	}

	private page(tab: BrowserTabArgs): PageContents {
		const contents = this.openContents(tab);
		if (!contents) throw new Error(NOTHING_OPEN);
		return contents;
	}

	private openContents(tab: BrowserTabArgs): PageContents | null {
		if (!this.entries.has(tabKey(tab))) return null;
		const { contents } = this.ensure(tab).view;
		return contents.getURL().length > 0 ? contents : null;
	}

	private ensure(tab: BrowserTabArgs): Entry<W> {
		const existing = this.entries.get(tabKey(tab));
		const entry =
			existing?.alive && !existing.view.contents.isDestroyed()
				? existing
				: this.create(tab, existing);
		this.attach(entry);
		return entry;
	}

	private create(tab: BrowserTabArgs, previous: Entry<W> | undefined): Entry<W> {
		if (!this.deps.workstreamExists(tab.workstreamId)) {
			throw new Error(`unknown workstream \`${tab.workstreamId}\``);
		}
		if (previous) this.dispose(previous);
		const entry: Entry<W> = {
			tab: { workstreamId: tab.workstreamId, tabId: tab.tabId },
			favicon: null,
			view: this.deps.createView({
				changed: () => this.changed(entry),
				favicon: (favicon) => {
					entry.favicon = favicon;
					this.changed(entry);
				},
				navigating: (url) => {
					entry.pending = url;
					entry.pick?.controller.abort();
					this.stopPins(entry);
					this.changed(entry);
				},
				ready: () => this.showPins(entry),
				movedInPage: () => this.showPins(entry),
				committed: () => {
					entry.failure = null;
					entry.pending = null;
					entry.consoleLines = [];
					entry.consoleDropped = 0;
				},
				console: (line) => {
					const text =
						line.text.length > MAX_CONSOLE_TEXT
							? `${line.text.slice(0, MAX_CONSOLE_TEXT)}…`
							: line.text;
					entry.consoleLines.push({ ...line, text });
					if (entry.consoleLines.length <= MAX_CONSOLE_LINES) return;
					entry.consoleLines.shift();
					entry.consoleDropped += 1;
				},
				failed: (reason) => {
					entry.failure = reason;
					entry.pending = null;
					this.changed(entry);
				},
				gone: () => {
					entry.alive = false;
					entry.pick?.controller.abort();
					this.stopPins(entry);
				},
			}),
			window: null,
			alive: true,
			shown: false,
			bounds: previous?.bounds ?? { x: 0, y: 0, ...DEFAULT_VIEW_SIZE },
			lastUrl: previous?.lastUrl ?? '',
			failure: null,
			pending: null,
			pick: null,
			pinActions: null,
			consoleLines: [],
			consoleDropped: 0,
		};
		entry.view.setBounds(entry.bounds);
		entry.view.setBorderRadius(CORNER_RADIUS);
		this.entries.set(tabKey(tab), entry);
		if (entry.lastUrl) this.load(entry, entry.lastUrl);
		return entry;
	}

	private load(entry: Entry<W>, url: string): void {
		entry.pending = url;
		void entry.view.contents.loadURL(url).catch(() => undefined);
	}

	private attach(entry: Entry<W>): void {
		const window = this.deps.getMainWindow();
		if (!window || window.isDestroyed() || entry.window === window) return;
		if (entry.window && !entry.window.isDestroyed()) entry.view.removeFrom(entry.window);
		entry.view.placeIn(window, 'back');
		entry.window = window;
		entry.shown = false;
		if (this.watchedWindows.has(window)) return;
		this.watchedWindows.add(window);
		this.deps.watchRendererReset(window, () => this.lowerAll(window));
	}

	private lowerAll(window: W): void {
		if (window.isDestroyed()) return;
		for (const entry of this.entries.values()) {
			if (!entry.alive || entry.window !== window) continue;
			entry.pick?.controller.abort();
			entry.shown = false;
			entry.view.placeIn(window, 'back');
		}
	}

	private changed(entry: Entry<W>): void {
		if (!entry.alive || this.entries.get(tabKey(entry.tab)) !== entry) return;
		if (!entry.view.contents.isLoading()) entry.pending = null;
		const state = stateOf(entry);
		if (state.url.length > 0) entry.lastUrl = state.url;
		this.deps.stateChanged(state);
	}

	private returnFocus(entry: Entry<W>): void {
		const window = entry.window;
		if (!entry.alive || !window || window.isDestroyed() || !window.isFocused()) return;
		if (entry.view.contents.isFocused()) window.webContents.focus();
	}

	private showPins(entry: Entry<W>): void {
		if (!entry.alive || this.entries.get(tabKey(entry.tab)) !== entry) return;
		const contents = this.openContents(entry.tab);
		if (!contents || entry.pick) return;
		const pins = pinsOnPage(this.deps.threads(entry.tab.workstreamId), contents.getURL());
		if (pins.length === 0 && entry.pinActions === null) return;
		const page = pinsPage(contents);
		void page.run({ kind: 'show', pins }).catch(() => undefined);
		if (entry.pinActions === null) void this.watchPins(entry, page);
	}

	private async watchPins(entry: Entry<W>, page: PinsPage): Promise<void> {
		const controller = new AbortController();
		entry.pinActions = controller;
		try {
			for (;;) {
				const action = readPinAction(
					await untilAborted(page.run({ kind: 'action' }), controller.signal),
				);
				if (action === null || controller.signal.aborted) return;
				await this.deps.threadAction(entry.tab, action);
			}
		} catch {
			return;
		} finally {
			if (entry.pinActions === controller) entry.pinActions = null;
		}
	}

	private stopPins(entry: Entry<W>): void {
		entry.pinActions?.abort();
		entry.pinActions = null;
	}

	private dispose(entry: Entry<W>): void {
		entry.alive = false;
		entry.pick?.controller.abort();
		this.stopPins(entry);
		if (entry.window && !entry.window.isDestroyed()) entry.view.removeFrom(entry.window);
		entry.view.close();
	}
}

export function toDip(bounds: BrowserBounds, zoom: number): Rectangle {
	const x = Math.round(bounds.x * zoom);
	const y = Math.round(bounds.y * zoom);
	return {
		x,
		y,
		width: Math.round((bounds.x + bounds.width) * zoom) - x,
		height: Math.round((bounds.y + bounds.height) * zoom) - y,
	};
}

function tabKey(tab: BrowserTabArgs): string {
	return `${tab.workstreamId}/${tab.tabId}`;
}

function stateOf<W extends HostWindow>({
	tab,
	view,
	favicon,
	failure,
	pending,
}: Entry<W>): BrowserState {
	const { contents } = view;
	const shown = contents.getURL();
	const url = pending ?? shown;
	return {
		...tab,
		url,
		title: contents.getTitle(),
		favicon,
		loading: contents.isLoading(),
		canGoBack: contents.navigationHistory.canGoBack(),
		canGoForward: contents.navigationHistory.canGoForward(),
		failure: url === shown ? failure : null,
	};
}

async function settledPage(contents: PageContents): Promise<BrowserPageInfo> {
	await settleAfterAction(contents);
	return pageInfo(contents);
}

function pageInfo(contents: PageContents): BrowserPageInfo {
	return { url: contents.getURL(), title: contents.getTitle() };
}
