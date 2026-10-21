import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserState } from '$contract/browser';
import { PREVIEW_LONG_EDGE } from './automation';
import type { PageContents, PageEvents, PageImage, PageView, Rectangle } from './page';
import { BrowserViews, DEFAULT_VIEW_SIZE, NOTHING_OPEN, toDip } from './views';

class FakeWindow {
	destroyed = false;
	focusCount = 0;
	readonly webContents = {
		getZoomFactor: (): number => this.zoom,
		focus: (): void => {
			this.focusCount += 1;
		},
	};

	constructor(private readonly zoom = 1) {}

	isDestroyed(): boolean {
		return this.destroyed;
	}
}

class FakeImage implements PageImage {
	constructor(
		private readonly width: number,
		private readonly height: number,
	) {}

	isEmpty(): boolean {
		return this.width === 0 || this.height === 0;
	}

	getSize(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}

	resize(options: { width?: number; height?: number }): PageImage {
		const scale = options.width ? options.width / this.width : (options.height ?? 0) / this.height;
		return new FakeImage(Math.round(this.width * scale), Math.round(this.height * scale));
	}

	toPNG(): Buffer {
		return Buffer.from(`png ${this.width}x${this.height}`);
	}

	toJPEG(quality: number): Buffer {
		return Buffer.from(`jpeg ${this.width}x${this.height} q${quality}`);
	}
}

class FakeContents implements PageContents {
	url = '';
	title = '';
	destroyed = false;
	focused = false;
	reloads = 0;
	readonly loads: string[] = [];
	readonly loadFailures: string[] = [];
	readonly scripts: string[] = [];
	actionOutcome: unknown = 'done';
	static #nextProcessId = 4_000;
	readonly processId = FakeContents.#nextProcessId++;
	frame = new FakeImage(2_560, 1_600);
	captureFailure: Error | null = null;
	readonly steps: string[] = [];
	readonly navigationHistory = {
		canGoBack: (): boolean => this.loads.length > 1,
		canGoForward: (): boolean => this.steps.includes('back'),
		goBack: (): void => void this.steps.push('back'),
		goForward: (): void => void this.steps.push('forward'),
	};

	loadURL(url: string): Promise<void> {
		this.loads.push(url);
		this.url = url;
		this.title = `Title of ${url}`;
		const failure = this.loadFailures.shift();
		return failure
			? Promise.reject(Object.assign(new Error(failure), { code: failure }))
			: Promise.resolve();
	}

	getURL(): string {
		return this.url;
	}

	getTitle(): string {
		return this.title;
	}

	isLoading(): boolean {
		return false;
	}

	isDestroyed(): boolean {
		return this.destroyed;
	}

	isFocused(): boolean {
		return this.focused;
	}

	getOSProcessId(): number {
		return this.processId;
	}

	focus(): void {
		this.focused = true;
	}

	reload(): void {
		this.reloads += 1;
	}

	getZoomFactor(): number {
		return 1;
	}

	capturePage(): Promise<PageImage> {
		if (this.captureFailure) return Promise.reject(this.captureFailure);
		return Promise.resolve(this.frame);
	}

	executeJavaScript(): Promise<unknown> {
		return Promise.resolve(null);
	}

	executeJavaScriptInIsolatedWorld(
		_worldId: number,
		scripts: Array<{ code: string }>,
	): Promise<unknown> {
		const code = scripts[0]?.code ?? '';
		this.scripts.push(code);
		if (code.includes('"kind":"select"')) return new Promise(() => undefined);
		if (code.includes('"kind":"end"')) return Promise.resolve(null);
		return Promise.resolve(this.actionOutcome);
	}
}

class FakeView implements PageView<FakeWindow> {
	readonly contents = new FakeContents();
	readonly bounds: Rectangle[] = [];
	readonly placements: Array<readonly [FakeWindow, 'front' | 'back']> = [];
	readonly removedFrom: FakeWindow[] = [];
	readonly visibility: boolean[] = [];
	radius: number | null = null;
	closed = false;

	constructor(readonly events: PageEvents) {}

	setBounds(bounds: Rectangle): void {
		this.bounds.push(bounds);
	}

	setBorderRadius(radius: number): void {
		this.radius = radius;
	}

	placeIn(window: FakeWindow, layer: 'front' | 'back'): void {
		this.placements.push([window, layer]);
	}

	setVisible(visible: boolean): void {
		this.visibility.push(visible);
	}

	removeFrom(window: FakeWindow): void {
		this.removedFrom.push(window);
	}

	close(): void {
		this.closed = true;
	}
}

const TAB = { workstreamId: 'ws-1', tabId: 'tab-1' } as const;
const OTHER_TAB = { workstreamId: 'ws-2', tabId: 'tab-1' } as const;

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(zoom = 1) {
	let window: FakeWindow | null = new FakeWindow(zoom);
	const views: FakeView[] = [];
	const states: BrowserState[] = [];
	const opened: unknown[] = [];
	const resets = new Map<FakeWindow, () => void>();
	const browser = new BrowserViews<FakeWindow>({
		getMainWindow: () => window,
		createView: (events) => {
			const view = new FakeView(events);
			views.push(view);
			return view;
		},
		watchRendererReset: (watched, reset) => {
			if (resets.has(watched)) throw new Error('watched the same window twice');
			resets.set(watched, reset);
		},
		workstreamExists: (workstreamId) => workstreamId.startsWith('ws-'),
		worktree: (workstreamId) => `/work/${workstreamId}`,
		stateChanged: (state) => states.push(state),
		tabOpened: (tab) => opened.push(tab),
	});
	const viewAt = (index: number): FakeView => {
		const view = views[index];
		if (!view) throw new Error(`no view ${index}`);
		return view;
	};
	return {
		browser,
		views,
		states,
		opened,
		viewAt,
		resetRenderer(of: FakeWindow): void {
			resets.get(of)?.();
		},
		replaceWindow(next: FakeWindow | null): void {
			if (window) window.destroyed = true;
			window = next;
		},
		window: (): FakeWindow => {
			if (!window) throw new Error('no window');
			return window;
		},
	};
}

describe('BrowserViews', () => {
	it('creates a view on first show behind malini, then raises it to the reported bounds', () => {
		const { browser, views, viewAt, window } = setup(1.25);
		browser.show(TAB, { x: 10, y: 20, width: 300, height: 200 });

		expect(views).toHaveLength(1);
		const view = viewAt(0);
		expect(view.bounds).toEqual([
			{ x: 0, y: 0, ...DEFAULT_VIEW_SIZE },
			{ x: 13, y: 25, width: 375, height: 250 },
		]);
		expect(view.placements).toEqual([
			[window(), 'back'],
			[window(), 'front'],
		]);
		expect(view.radius).toBe(20);
	});

	it('sends every view behind malini when its own page reloads, since no panel is left to hide them', () => {
		const { browser, viewAt, window, resetRenderer } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 100, height: 100 });
		browser.show(OTHER_TAB, { x: 0, y: 0, width: 100, height: 100 });
		browser.show(TAB, { x: 0, y: 0, width: 100, height: 100 });

		resetRenderer(window());

		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(viewAt(1).placements.at(-1)).toEqual([window(), 'back']);
	});

	it('sends a hidden view behind malini and keeps its size', () => {
		const { browser, views, viewAt, window } = setup();
		browser.hide(TAB);
		expect(views).toHaveLength(0);

		browser.show(TAB, { x: 0, y: 0, width: 640, height: 480 });
		browser.hide(TAB);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(viewAt(0).bounds.at(-1)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
	});

	it('moves views into a main window that was recreated', () => {
		const { browser, viewAt, replaceWindow } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 100, height: 100 });
		const replacement = new FakeWindow();
		replaceWindow(replacement);
		browser.show(TAB, { x: 0, y: 0, width: 100, height: 100 });

		expect(viewAt(0).removedFrom).toEqual([]);
		expect(viewAt(0).placements.slice(-2)).toEqual([
			[replacement, 'back'],
			[replacement, 'front'],
		]);
	});

	it('reports page changes as browser state', () => {
		const { browser, states, viewAt } = setup();
		browser.navigate(TAB, 'http://localhost:5173/');
		viewAt(0).events.changed();

		expect(states).toEqual([
			{
				...TAB,
				url: 'http://localhost:5173/',
				title: 'Title of http://localhost:5173/',
				favicon: null,
				loading: false,
				canGoBack: false,
				canGoForward: false,
			},
		]);
		expect(browser.state(OTHER_TAB)).toMatchObject({ ...OTHER_TAB, url: '' });
	});

	it('recreates a view whose page died and reloads the address it showed', () => {
		const { browser, views, viewAt } = setup();
		browser.navigate(TAB, 'http://localhost:5173/');
		viewAt(0).events.changed();
		viewAt(0).events.gone();
		expect(browser.state(TAB)).toMatchObject({ url: 'http://localhost:5173/', loading: false });

		browser.reload(TAB);
		expect(views).toHaveLength(2);
		expect(viewAt(0).closed).toBe(true);
		expect(viewAt(1).contents.loads).toEqual(['http://localhost:5173/']);
		expect(viewAt(1).contents.reloads).toBe(1);
	});

	it('gives every tab its own page and closes one tab without touching the others', () => {
		const { browser, viewAt, window } = setup();
		const second = { ...TAB, tabId: 'tab-2' };
		browser.navigate(TAB, 'http://localhost:5173/');
		browser.navigate(second, 'https://music.example/');
		browser.navigate(OTHER_TAB, 'https://example.com/');
		expect(browser.state(second).url).toBe('https://music.example/');

		browser.destroy(TAB);
		expect(viewAt(0).closed).toBe(true);
		expect(viewAt(0).removedFrom).toEqual([window()]);
		expect(browser.state(TAB).url).toBe('');
		expect(viewAt(1).closed).toBe(false);

		browser.destroyWorkstream('ws-1');
		expect(viewAt(1).closed).toBe(true);
		expect(viewAt(2).closed).toBe(false);
	});

	it('lists the page process and title of every open tab and forgets a closed one', () => {
		const { browser, viewAt } = setup();
		const second = { ...TAB, tabId: 'tab-2' };
		browser.navigate(TAB, 'http://localhost:5173/');
		browser.navigate(second, 'https://music.example/');
		expect(browser.tabProcesses()).toEqual([
			{ processId: viewAt(0).contents.processId, title: 'Title of http://localhost:5173/' },
			{ processId: viewAt(1).contents.processId, title: 'Title of https://music.example/' },
		]);

		browser.destroy(TAB);
		expect(browser.tabProcesses()).toEqual([
			{ processId: viewAt(1).contents.processId, title: 'Title of https://music.example/' },
		]);
	});

	it('reports the favicon of the page in its state', () => {
		const { browser, states, viewAt } = setup();
		browser.navigate(TAB, 'http://localhost:5173/');
		viewAt(0).events.favicon('data:image/png;base64,AA==');

		expect(states.at(-1)).toMatchObject({ ...TAB, favicon: 'data:image/png;base64,AA==' });
		expect(browser.state(TAB).favicon).toBe('data:image/png;base64,AA==');
	});

	it('refuses a workstream it does not know', () => {
		const { browser } = setup();
		expect(() =>
			browser.show({ workstreamId: 'nope', tabId: 'tab-1' }, { x: 0, y: 0, width: 1, height: 1 }),
		).toThrow('unknown workstream `nope`');
	});

	it('opens a typed address for the agent, waits for the page, then says a page is open', async () => {
		const { browser, viewAt, opened } = setup();
		await expect(browser.open(TAB, 'localhost:5173')).resolves.toEqual({
			url: 'http://localhost:5173/',
			title: 'Title of http://localhost:5173/',
		});
		expect(viewAt(0).contents.loads).toEqual(['http://localhost:5173/']);
		expect(opened).toEqual([TAB]);
		await browser.open(TAB, 'localhost:5173/next');
		expect(opened).toEqual([TAB]);
	});

	it('opens a file from the worktree as a page of its own workstream', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, '/work/ws-1/docs/a b.html');
		browser.navigate(TAB, './index.html');

		expect(viewAt(0).contents.loads).toEqual([
			'malini-worktree://ws-1/docs/a%20b.html',
			'malini-worktree://ws-1/index.html',
		]);
		await expect(browser.open(TAB, '/work/ws-2/index.html')).rejects.toThrow(
			'is outside the worktree',
		);
	});

	it('waits for a local server that is still starting, but not for a remote one', async () => {
		const { browser, viewAt } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		viewAt(0).contents.loadFailures.push('ERR_CONNECTION_REFUSED');
		await expect(browser.open(TAB, 'localhost:5173')).resolves.toMatchObject({
			url: 'http://localhost:5173/',
		});
		expect(viewAt(0).contents.loads).toEqual(['http://localhost:5173/', 'http://localhost:5173/']);

		viewAt(0).contents.loadFailures.push('ERR_CONNECTION_REFUSED');
		await expect(browser.open(TAB, 'https://example.com')).rejects.toThrow(
			'Could not open https://example.com/: ERR_CONNECTION_REFUSED',
		);
	});

	it('gives up on a local server that never starts', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
			viewAt(0).contents.loadFailures.push(...Array<string>(100).fill('ERR_CONNECTION_REFUSED'));
			const opening = browser.open(TAB, 'localhost:5173');
			const outcome = expect(opening).rejects.toThrow(
				'Could not open http://localhost:5173/: nothing listened on that port for 20s',
			);
			await vi.advanceTimersByTimeAsync(21_000);
			await outcome;
		} finally {
			vi.useRealTimers();
		}
	});

	it('refuses to capture or act on a page that did not load, until it loads again', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-failed-'));
		roots.push(worktree);
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'localhost:5173');
		viewAt(0).events.navigating();
		viewAt(0).events.failed('ERR_CONNECTION_REFUSED');

		const failed = 'http://localhost:5173/ did not load (ERR_CONNECTION_REFUSED).';
		await expect(browser.screenshot(TAB, worktree)).rejects.toThrow(failed);
		await expect(browser.click(TAB, 'a')).rejects.toThrow(failed);
		viewAt(0).events.navigating();
		await expect(browser.screenshot(TAB, worktree)).resolves.toMatchObject({
			url: 'http://localhost:5173/',
		});
	});

	it('steps back and forward for the agent and says when there is nowhere to go', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.goBack(TAB)).rejects.toThrow(NOTHING_OPEN);
		await browser.open(TAB, 'https://example.com');
		await expect(browser.goBack(TAB)).rejects.toThrow('There is no page to go back to.');
		await expect(browser.goForward(TAB)).rejects.toThrow('There is no page to go forward to.');

		await browser.open(TAB, 'https://example.com/next');
		await expect(browser.goBack(TAB)).resolves.toMatchObject({
			url: 'https://example.com/next',
		});
		await browser.goForward(TAB);
		await browser.reload(TAB);

		expect(viewAt(0).contents.steps).toEqual(['back', 'forward']);
		expect(viewAt(0).contents.reloads).toBe(1);
	});

	it('types for the agent and says when the target is not a field', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.type(TAB, '#q', 'malini', true)).rejects.toThrow(NOTHING_OPEN);
		await browser.open(TAB, 'https://example.com');

		await expect(browser.type(TAB, '#q', 'malini', true)).resolves.toMatchObject({
			url: 'https://example.com/',
		});
		expect(viewAt(0).contents.scripts.at(-1)).toMatch(/\("#q", "malini", true\)$/u);
		viewAt(0).contents.actionOutcome = 'readonly';
		await expect(browser.type(TAB, 'h1', 'x', false)).rejects.toThrow(
			'`h1` is not a field you can type into.',
		);
	});

	it('saves screenshots into the worktree sandbox with a small preview beside them', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-shots-'));
		roots.push(worktree);
		const { browser } = setup();
		await expect(browser.screenshot(TAB, worktree)).rejects.toThrow(NOTHING_OPEN);
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		await expect(browser.screenshot(TAB, worktree)).rejects.toThrow(NOTHING_OPEN);

		await browser.open(TAB, 'https://example.com');
		const first = await browser.screenshot(TAB, worktree);
		const second = await browser.screenshot(TAB, worktree);

		expect(first.path).toMatch(/^\.malini\/sandbox\/screenshots\/\d{4}-\d\d-\d\d-\d{6}\.png$/);
		expect(second.path).toMatch(/-\d{6}(?:-2)?\.png$/);
		expect(second.path).not.toBe(first.path);
		expect(first.url).toBe('https://example.com/');
		expect(readFileSync(join(worktree, first.path), 'utf8')).toBe('png 2560x1600');
		expect(first.previewPath).toBe(join(worktree, first.path.replace(/\.png$/, '.jpg')));
		expect(existsSync(first.previewPath)).toBe(true);
		expect(readFileSync(first.previewPath, 'utf8')).toBe(`jpeg ${PREVIEW_LONG_EDGE}x980 q80`);
	});

	it('renders a hidden view beside the window only while it captures it, then hides it in place', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-hidden-'));
		roots.push(worktree);
		const { browser, viewAt } = setup();
		browser.show(TAB, { x: 40, y: 50, width: 300, height: 200 });
		browser.hide(TAB);
		await browser.open(TAB, 'https://example.com');

		await browser.screenshot(TAB, worktree);

		expect(viewAt(0).bounds.slice(-2)).toEqual([
			{ x: -364, y: 0, width: 300, height: 200 },
			{ x: 40, y: 50, width: 300, height: 200 },
		]);
		expect(viewAt(0).visibility).toEqual([true, false]);
	});

	it('has no snapshot when the compositor fails to copy a frame', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		viewAt(0).contents.captureFailure = new Error('UnknownVizError');

		expect(await browser.snapshot(TAB)).toBeNull();
	});

	it('clicks for the agent and says so when nothing matches', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.click(TAB, '#buy')).rejects.toThrow(NOTHING_OPEN);
		await browser.open(TAB, 'https://example.com');

		await expect(browser.click(TAB, '#buy')).resolves.toEqual({
			url: 'https://example.com/',
			title: 'Title of https://example.com/',
		});
		viewAt(0).contents.actionOutcome = 'missing';
		await expect(browser.click(TAB, '#gone')).rejects.toThrow(
			'Nothing on the page matches `#gone`.',
		);
		viewAt(0).contents.actionOutcome = 'invalid';
		await expect(browser.click(TAB, '[')).rejects.toThrow('`[` is not a valid CSS selector.');
	});

	it('keeps one pick per view: a new pick or a cancel ends the open one', async () => {
		const { browser, viewAt, window } = setup();
		await expect(browser.pick(TAB)).rejects.toThrow('Open a page before picking an element.');
		await browser.open(TAB, 'https://example.com');

		const first = browser.pick(TAB);
		const second = browser.pick(TAB);
		await expect(first).resolves.toBeNull();
		browser.cancelPick(TAB);
		await expect(second).resolves.toBeNull();

		const ends = viewAt(0).contents.scripts.filter((code) => code.includes('"kind":"end"'));
		expect(ends).toHaveLength(2);
		expect(window().focusCount).toBe(2);
	});

	it('converts CSS pixels to window pixels without gaps between neighbours', () => {
		expect(toDip({ x: 0.5, y: 0.5, width: 99.5, height: 10 }, 1.5)).toEqual({
			x: 1,
			y: 1,
			width: 149,
			height: 15,
		});
	});
});
