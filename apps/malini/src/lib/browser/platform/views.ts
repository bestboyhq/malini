import type {
	BrowserBounds,
	BrowserElementPrompt,
	BrowserState,
	BrowserTabArgs,
} from '$contract/browser';
import type { BrowserPageInfo, BrowserPlatform, BrowserScreenshotFile } from '../browser.platform';
import {
	clickSelector,
	delay,
	openUrl,
	saveScreenshot,
	settleAfterAction,
	typeIntoSelector,
} from './automation';
import type { HostWindow, PageContents, PageEvents, PageView, Rectangle } from './page';
import { pickElement, pickerPage } from './picker';
import { BLANK_PAGE, normalizeBrowserUrl } from './url';

export const DEFAULT_VIEW_SIZE = { width: 1_280, height: 800 } as const;
export const CORNER_RADIUS = 16;
export const OFFSCREEN_RENDER_MS = 150;
const OFFSCREEN_GAP = 64;
export const NOTHING_OPEN = 'Nothing is open in the browser yet. Call browser_open first.';

export interface BrowserViewsDeps<W extends HostWindow> {
	getMainWindow(): W | null;
	createView(events: PageEvents): PageView<W>;
	watchRendererReset(window: W, reset: () => void): void;
	workstreamExists(workstreamId: string): boolean;
	stateChanged(state: BrowserState): void;
	tabOpened(tab: BrowserTabArgs): void;
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
	pick: OpenPick | null;
}

export class BrowserViews<W extends HostWindow> implements BrowserPlatform {
	private readonly entries = new Map<string, Entry<W>>();
	private readonly watchedWindows = new WeakSet<W>();

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
		void this.ensure(tab)
			.view.contents.loadURL(url)
			.catch(() => undefined);
	}

	async goBack(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		const contents = this.page(tab);
		if (!contents.navigationHistory.canGoBack()) throw new Error('There is no page to go back to.');
		contents.navigationHistory.goBack();
		return settledPage(contents);
	}

	async goForward(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		const contents = this.page(tab);
		if (!contents.navigationHistory.canGoForward()) {
			throw new Error('There is no page to go forward to.');
		}
		contents.navigationHistory.goForward();
		return settledPage(contents);
	}

	async reload(tab: BrowserTabArgs): Promise<BrowserPageInfo> {
		const contents = this.page(tab);
		contents.reload();
		return settledPage(contents);
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
		};
	}

	async snapshot(tab: BrowserTabArgs): Promise<string | null> {
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) return null;
		const image = await this.rendered(entry, () =>
			contents.capturePage(undefined, { stayHidden: true }),
		);
		if (image.isEmpty()) return null;
		return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
	}

	async pick(tab: BrowserTabArgs): Promise<BrowserElementPrompt | null> {
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) throw new Error('Open a page before picking an element.');
		while (entry.pick) {
			entry.pick.controller.abort();
			await entry.pick.done;
		}
		const controller = new AbortController();
		contents.focus();
		const picking = pickElement(pickerPage(contents), controller.signal);
		const pick: OpenPick = { controller, done: picking.catch(() => null) };
		entry.pick = pick;
		try {
			return await picking;
		} finally {
			if (entry.pick === pick) entry.pick = null;
			this.returnFocus(entry);
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

	async open(tab: BrowserTabArgs, url: string): Promise<BrowserPageInfo> {
		const fresh = this.openContents(tab) === null;
		const { contents } = this.ensure(tab).view;
		await openUrl(contents, normalizeBrowserUrl(url));
		if (fresh) this.deps.tabOpened({ workstreamId: tab.workstreamId, tabId: tab.tabId });
		return pageInfo(contents);
	}

	async screenshot(tab: BrowserTabArgs, worktree: string): Promise<BrowserScreenshotFile> {
		const contents = this.openContents(tab);
		const entry = this.entries.get(tabKey(tab));
		if (!contents || !entry) throw new Error(NOTHING_OPEN);
		return this.rendered(entry, () => saveScreenshot(contents, worktree, new Date()));
	}

	async click(tab: BrowserTabArgs, selector: string): Promise<BrowserPageInfo> {
		const contents = this.page(tab);
		await clickSelector(contents, selector);
		return pageInfo(contents);
	}

	async type(
		tab: BrowserTabArgs,
		selector: string,
		text: string,
		submit: boolean,
	): Promise<BrowserPageInfo> {
		const contents = this.page(tab);
		await typeIntoSelector(contents, selector, text, submit);
		return pageInfo(contents);
	}

	private async rendered<T>(entry: Entry<W>, capture: () => Promise<T>): Promise<T> {
		if (entry.shown) return capture();
		const { width, height } = entry.bounds;
		entry.view.setBounds({ x: -(width + OFFSCREEN_GAP), y: 0, width, height });
		entry.view.setVisible(true);
		await delay(OFFSCREEN_RENDER_MS);
		try {
			return await capture();
		} finally {
			if (!entry.shown && entry.alive) {
				entry.view.setVisible(false);
				entry.view.setBounds(entry.bounds);
			}
		}
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
				navigating: () => entry.pick?.controller.abort(),
				gone: () => {
					entry.alive = false;
					entry.pick?.controller.abort();
				},
			}),
			window: null,
			alive: true,
			shown: false,
			bounds: previous?.bounds ?? { x: 0, y: 0, ...DEFAULT_VIEW_SIZE },
			lastUrl: previous?.lastUrl ?? '',
			pick: null,
		};
		entry.view.setBounds(entry.bounds);
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

	private dispose(entry: Entry<W>): void {
		entry.alive = false;
		entry.pick?.controller.abort();
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

function stateOf<W extends HostWindow>({ tab, view, favicon }: Entry<W>): BrowserState {
	const { contents } = view;
	return {
		...tab,
		url: contents.getURL(),
		title: contents.getTitle(),
		favicon,
		loading: contents.isLoading(),
		canGoBack: contents.navigationHistory.canGoBack(),
		canGoForward: contents.navigationHistory.canGoForward(),
	};
}

async function settledPage(contents: PageContents): Promise<BrowserPageInfo> {
	await settleAfterAction(contents);
	return pageInfo(contents);
}

function pageInfo(contents: PageContents): BrowserPageInfo {
	return { url: contents.getURL(), title: contents.getTitle() };
}
