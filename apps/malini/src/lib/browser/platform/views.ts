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
	BrowserPageInfo,
	BrowserPlatform,
	BrowserScreenshotFile,
	BrowserTabProcess,
} from '../browser.platform';
import {
	captureFrame,
	clickSelector,
	openUrl,
	saveScreenshot,
	settleAfterAction,
	typeIntoSelector,
	within,
} from './automation';
import type { HostWindow, PageContents, PageEvents, PageView, Rectangle } from './page';
import { pickElement, pickerPage, untilAborted } from './picker';
import {
	pinsOnPage,
	pinsPage,
	readPinAction,
	type PinAction,
	type PinsPage,
	type ThreadPin,
} from './thread-pins';
import { BLANK_PAGE, isFileAddress, normalizeBrowserUrl, worktreeFileUrl } from './url';

export const DEFAULT_VIEW_SIZE = { width: 1_280, height: 800 } as const;
export const CORNER_RADIUS = 16;
export const NOTHING_OPEN = 'Nothing is open in the browser yet. Call browser_open first.';
export const RESIZE_ANSWER_MS = 5_000;

export interface BrowserViewsDeps<W extends HostWindow> {
	getMainWindow(): W | null;
	onScreen(window: W): boolean;
	createView(events: PageEvents): PageView<W>;
	watchRendererReset(window: W, reset: () => void): void;
	workstreamExists(workstreamId: string): boolean;
	worktree(workstreamId: string): string;
	stateChanged(state: BrowserState): void;
	tabOpened(tab: BrowserTabArgs): void;
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
	pick: OpenPick | null;
	pinActions: AbortController | null;
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
		entry.shown = true;
		entry.bounds = toDip(bounds, zoom);
		entry.view.placeIn(window, 'front');
		entry.view.setBounds(entry.bounds);
		entry.view.setBorderRadius(Math.round(CORNER_RADIUS * zoom));
	}

	hide(tab: BrowserTabArgs): void {
		const entry = this.entries.get(tabKey(tab));
		if (!entry?.alive || !entry.window || entry.window.isDestroyed()) return;
		entry.shown = false;
		entry.view.placeIn(entry.window, 'back');
	}

	navigate(tab: BrowserTabArgs, url: string): void {
		const address = this.address(tab, url);
		void this.ensure(tab)
			.view.contents.loadURL(address)
			.catch(() => undefined);
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
			.map(({ view: { contents } }) => ({
				processId: contents.getOSProcessId(),
				title: contents.getTitle() || contents.getURL(),
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

	async pick(args: BrowserPickArgs): Promise<BrowserThreadStarted | null> {
		const tab = { workstreamId: args.workstreamId, tabId: args.tabId };
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) throw new Error('Open a page before picking an element.');
		while (entry.pick) {
			entry.pick.controller.abort();
			await entry.pick.done;
		}
		const controller = new AbortController();
		contents.focus();
		const picking = pickElement(
			pickerPage(contents),
			controller.signal,
			{ model: args.model, models: args.models },
			(picked) => this.deps.startThread(tab, picked, args.profile),
		);
		const pick: OpenPick = { controller, done: picking.catch(() => null) };
		entry.pick = pick;
		try {
			return await picking;
		} finally {
			if (entry.pick === pick) entry.pick = null;
			this.returnFocus(entry);
			this.showPins(entry);
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
			const opening = openUrl(contents, address);
			if (fresh) this.deps.tabOpened({ workstreamId: tab.workstreamId, tabId: tab.tabId });
			await opening;
			return pageInfo(contents);
		});
	}

	screenshot(tab: BrowserTabArgs, worktree: string): Promise<BrowserScreenshotFile> {
		return this.inTurn(tab, async () => {
			const { contents, entry } = this.loaded(tab);
			return this.rendered(entry, () => saveScreenshot(contents, worktree, new Date()));
		});
	}

	click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const { contents } = this.loaded(tab);
			await clickSelector(contents, selector);
			return pageInfo(contents);
		});
	}

	type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo> {
		return this.inTurn(tab, async () => {
			const { contents } = this.loaded(tab);
			await typeIntoSelector(contents, selector, text, submit);
			return pageInfo(contents);
		});
	}

	resize(tab: BrowserTabArgs, width: number): Promise<number> {
		return this.inTurn(tab, async () => {
			const { entry } = this.loaded(tab);
			const window = entry.window;
			if (!window || window.isDestroyed() || !entry.shown || !this.deps.onScreen(window)) {
				throw new Error(
					`The browser tab is not on screen, so its width did not change: the page is ${entry.bounds.width}px wide. Malini resizes it only while the user sees the tab.`,
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
			return entry.bounds.width;
		});
	}

	resized(requestId: string): void {
		this.resizes.get(requestId)?.();
	}

	private inTurn<T>(tab: BrowserTabArgs, work: () => Promise<T>): Promise<T> {
		const key = tabKey(tab);
		const previous = this.turns.get(key);
		const turn = (async (): Promise<T> => {
			await previous;
			return work();
		})();
		this.turns.set(
			key,
			turn.catch(() => undefined),
		);
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
		if (entry.failure) {
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
		const url = contents.getURL();
		return url.length > 0 && url !== BLANK_PAGE ? contents : null;
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
				navigating: () => {
					entry.pick?.controller.abort();
					this.stopPins(entry);
				},
				ready: () => this.showPins(entry),
				movedInPage: () => this.showPins(entry),
				committed: () => {
					entry.failure = null;
				},
				failed: (reason) => {
					entry.failure = reason;
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
			pick: null,
			pinActions: null,
		};
		entry.view.setBounds(entry.bounds);
		entry.view.setBorderRadius(CORNER_RADIUS);
		this.entries.set(tabKey(tab), entry);
		if (entry.lastUrl) void entry.view.contents.loadURL(entry.lastUrl).catch(() => undefined);
		return entry;
	}

	private attach(entry: Entry<W>): void {
		const window = this.deps.getMainWindow();
		if (!window || window.isDestroyed() || entry.window === window) return;
		if (entry.window && !entry.window.isDestroyed()) entry.view.removeFrom(entry.window);
		entry.view.placeIn(window, 'back');
		entry.window = window;
		if (this.watchedWindows.has(window)) return;
		this.watchedWindows.add(window);
		this.deps.watchRendererReset(window, () => this.lowerAll(window));
	}

	private lowerAll(window: W): void {
		if (window.isDestroyed()) return;
		for (const entry of this.entries.values()) {
			if (!entry.alive || entry.window !== window) continue;
			entry.shown = false;
			entry.view.placeIn(window, 'back');
		}
	}

	private changed(entry: Entry<W>): void {
		if (!entry.alive || this.entries.get(tabKey(entry.tab)) !== entry) return;
		const state = stateOf(entry);
		if (state.url.length > 0) entry.lastUrl = state.url;
		this.deps.stateChanged(state);
	}

	private returnFocus(entry: Entry<W>): void {
		const window = entry.window;
		if (!entry.alive || !window || window.isDestroyed()) return;
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

function stateOf<W extends HostWindow>({ tab, view, favicon, failure }: Entry<W>): BrowserState {
	const { contents } = view;
	return {
		...tab,
		url: contents.getURL(),
		title: contents.getTitle(),
		favicon,
		loading: contents.isLoading(),
		canGoBack: contents.navigationHistory.canGoBack(),
		canGoForward: contents.navigationHistory.canGoForward(),
		failure,
	};
}

async function settledPage(contents: PageContents): Promise<BrowserPageInfo> {
	await settleAfterAction(contents);
	return pageInfo(contents);
}

function pageInfo(contents: PageContents): BrowserPageInfo {
	return { url: contents.getURL(), title: contents.getTitle() };
}
