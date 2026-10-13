import type { BrowserBounds, BrowserElementPrompt, BrowserState } from '$contract/browser';
import type { BrowserPageInfo, BrowserPlatform, BrowserScreenshotFile } from '../browser.platform';
import { clickSelector, delay, openUrl, saveScreenshot } from './automation';
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
}

interface OpenPick {
	readonly controller: AbortController;
	readonly done: Promise<unknown>;
}

interface Entry<W extends HostWindow> {
	readonly view: PageView<W>;
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

	show(workstreamId: string, bounds: BrowserBounds): void {
		const entry = this.ensure(workstreamId);
		const window = entry.window;
		if (!window || window.isDestroyed()) return;
		const zoom = window.webContents.getZoomFactor();
		entry.shown = true;
		entry.bounds = toDip(bounds, zoom);
		entry.view.placeIn(window, 'front');
		entry.view.setBounds(entry.bounds);
		entry.view.setBorderRadius(Math.round(CORNER_RADIUS * zoom));
	}

	hide(workstreamId: string): void {
		const entry = this.entries.get(workstreamId);
		if (!entry?.alive || !entry.window || entry.window.isDestroyed()) return;
		entry.shown = false;
		entry.view.placeIn(entry.window, 'back');
	}

	navigate(workstreamId: string, url: string): void {
		void this.ensure(workstreamId)
			.view.contents.loadURL(url)
			.catch(() => undefined);
	}

	goBack(workstreamId: string): void {
		const history = this.ensure(workstreamId).view.contents.navigationHistory;
		if (history.canGoBack()) history.goBack();
	}

	goForward(workstreamId: string): void {
		const history = this.ensure(workstreamId).view.contents.navigationHistory;
		if (history.canGoForward()) history.goForward();
	}

	reload(workstreamId: string): void {
		this.ensure(workstreamId).view.contents.reload();
	}

	state(workstreamId: string): BrowserState {
		const entry = this.entries.get(workstreamId);
		if (entry?.alive) return stateOf(workstreamId, entry.view.contents);
		return {
			workstreamId,
			url: entry?.lastUrl ?? '',
			title: '',
			loading: false,
			canGoBack: false,
			canGoForward: false,
		};
	}

	async snapshot(workstreamId: string): Promise<string | null> {
		const contents = this.openContents(workstreamId);
		const entry = this.entries.get(workstreamId);
		if (!contents || !entry) return null;
		const image = await this.rendered(entry, () =>
			contents.capturePage(undefined, { stayHidden: true }),
		);
		if (image.isEmpty()) return null;
		return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
	}

	async pick(workstreamId: string): Promise<BrowserElementPrompt | null> {
		const contents = this.openContents(workstreamId);
		const entry = this.entries.get(workstreamId);
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

	cancelPick(workstreamId: string): void {
		this.entries.get(workstreamId)?.pick?.controller.abort();
	}

	destroy(workstreamId: string): void {
		const entry = this.entries.get(workstreamId);
		if (!entry) return;
		this.entries.delete(workstreamId);
		this.dispose(entry);
	}

	async open(workstreamId: string, url: string): Promise<BrowserPageInfo> {
		const { contents } = this.ensure(workstreamId).view;
		await openUrl(contents, normalizeBrowserUrl(url));
		return pageInfo(contents);
	}

	async screenshot(workstreamId: string, worktree: string): Promise<BrowserScreenshotFile> {
		const contents = this.openContents(workstreamId);
		const entry = this.entries.get(workstreamId);
		if (!contents || !entry) throw new Error(NOTHING_OPEN);
		return this.rendered(entry, () => saveScreenshot(contents, worktree, new Date()));
	}

	async click(workstreamId: string, selector: string): Promise<BrowserPageInfo> {
		const contents = this.openContents(workstreamId);
		if (!contents) throw new Error(NOTHING_OPEN);
		await clickSelector(contents, selector);
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

	private openContents(workstreamId: string): PageContents | null {
		if (!this.entries.has(workstreamId)) return null;
		const { contents } = this.ensure(workstreamId).view;
		const url = contents.getURL();
		return url.length > 0 && url !== BLANK_PAGE ? contents : null;
	}

	private ensure(workstreamId: string): Entry<W> {
		const existing = this.entries.get(workstreamId);
		const entry =
			existing?.alive && !existing.view.contents.isDestroyed()
				? existing
				: this.create(workstreamId, existing);
		this.attach(entry);
		return entry;
	}

	private create(workstreamId: string, previous: Entry<W> | undefined): Entry<W> {
		if (!this.deps.workstreamExists(workstreamId)) {
			throw new Error(`unknown workstream \`${workstreamId}\``);
		}
		if (previous) this.dispose(previous);
		const entry: Entry<W> = {
			view: this.deps.createView({
				changed: () => this.changed(workstreamId, entry),
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
		this.entries.set(workstreamId, entry);
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

	private changed(workstreamId: string, entry: Entry<W>): void {
		if (!entry.alive || this.entries.get(workstreamId) !== entry) return;
		const state = stateOf(workstreamId, entry.view.contents);
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

function stateOf(workstreamId: string, contents: PageContents): BrowserState {
	return {
		workstreamId,
		url: contents.getURL(),
		title: contents.getTitle(),
		loading: contents.isLoading(),
		canGoBack: contents.navigationHistory.canGoBack(),
		canGoForward: contents.navigationHistory.canGoForward(),
	};
}

function pageInfo(contents: PageContents): BrowserPageInfo {
	return { url: contents.getURL(), title: contents.getTitle() };
}
