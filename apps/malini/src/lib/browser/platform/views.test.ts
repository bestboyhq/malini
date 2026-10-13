import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
	readonly scripts: string[] = [];
	clickOutcome: unknown = 'clicked';
	frame = new FakeImage(2_560, 1_600);
	readonly navigationHistory = {
		canGoBack: (): boolean => this.loads.length > 1,
		canGoForward: (): boolean => false,
		goBack: (): void => undefined,
		goForward: (): void => undefined,
	};

	loadURL(url: string): Promise<void> {
		this.loads.push(url);
		this.url = url;
		this.title = `Title of ${url}`;
		return Promise.resolve();
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
		return Promise.resolve(this.clickOutcome);
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

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(zoom = 1) {
	let window: FakeWindow | null = new FakeWindow(zoom);
	const views: FakeView[] = [];
	const states: BrowserState[] = [];
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
		stateChanged: (state) => states.push(state),
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
		browser.show('ws-1', { x: 10, y: 20, width: 300, height: 200 });

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
		browser.show('ws-1', { x: 0, y: 0, width: 100, height: 100 });
		browser.show('ws-2', { x: 0, y: 0, width: 100, height: 100 });
		browser.show('ws-1', { x: 0, y: 0, width: 100, height: 100 });

		resetRenderer(window());

		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(viewAt(1).placements.at(-1)).toEqual([window(), 'back']);
	});

	it('sends a hidden view behind malini and keeps its size', () => {
		const { browser, views, viewAt, window } = setup();
		browser.hide('ws-1');
		expect(views).toHaveLength(0);

		browser.show('ws-1', { x: 0, y: 0, width: 640, height: 480 });
		browser.hide('ws-1');
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(viewAt(0).bounds.at(-1)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
	});

	it('moves views into a main window that was recreated', () => {
		const { browser, viewAt, replaceWindow } = setup();
		browser.show('ws-1', { x: 0, y: 0, width: 100, height: 100 });
		const replacement = new FakeWindow();
		replaceWindow(replacement);
		browser.show('ws-1', { x: 0, y: 0, width: 100, height: 100 });

		expect(viewAt(0).removedFrom).toEqual([]);
		expect(viewAt(0).placements.slice(-2)).toEqual([
			[replacement, 'back'],
			[replacement, 'front'],
		]);
	});

	it('reports page changes as browser state', () => {
		const { browser, states, viewAt } = setup();
		browser.navigate('ws-1', 'http://localhost:5173/');
		viewAt(0).events.changed();

		expect(states).toEqual([
			{
				workstreamId: 'ws-1',
				url: 'http://localhost:5173/',
				title: 'Title of http://localhost:5173/',
				loading: false,
				canGoBack: false,
				canGoForward: false,
			},
		]);
		expect(browser.state('ws-2')).toMatchObject({ workstreamId: 'ws-2', url: '' });
	});

	it('recreates a view whose page died and reloads the address it showed', () => {
		const { browser, views, viewAt } = setup();
		browser.navigate('ws-1', 'http://localhost:5173/');
		viewAt(0).events.changed();
		viewAt(0).events.gone();
		expect(browser.state('ws-1')).toMatchObject({ url: 'http://localhost:5173/', loading: false });

		browser.reload('ws-1');
		expect(views).toHaveLength(2);
		expect(viewAt(0).closed).toBe(true);
		expect(viewAt(1).contents.loads).toEqual(['http://localhost:5173/']);
		expect(viewAt(1).contents.reloads).toBe(1);
	});

	it('destroys the view of a workstream that went away', () => {
		const { browser, viewAt, window } = setup();
		browser.navigate('ws-1', 'http://localhost:5173/');
		browser.destroy('ws-1');

		expect(viewAt(0).closed).toBe(true);
		expect(viewAt(0).removedFrom).toEqual([window()]);
		expect(browser.state('ws-1').url).toBe('');
	});

	it('refuses a workstream it does not know', () => {
		const { browser } = setup();
		expect(() => browser.show('nope', { x: 0, y: 0, width: 1, height: 1 })).toThrow(
			'unknown workstream `nope`',
		);
	});

	it('opens a typed address for the agent and waits for the page', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.open('ws-1', 'localhost:5173')).resolves.toEqual({
			url: 'http://localhost:5173/',
			title: 'Title of http://localhost:5173/',
		});
		expect(viewAt(0).contents.loads).toEqual(['http://localhost:5173/']);
	});

	it('saves screenshots into the worktree sandbox with a small preview beside them', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-shots-'));
		roots.push(worktree);
		const { browser } = setup();
		await expect(browser.screenshot('ws-1', worktree)).rejects.toThrow(NOTHING_OPEN);
		browser.show('ws-1', { x: 0, y: 0, width: 10, height: 10 });
		await expect(browser.screenshot('ws-1', worktree)).rejects.toThrow(NOTHING_OPEN);

		await browser.open('ws-1', 'https://example.com');
		const first = await browser.screenshot('ws-1', worktree);
		const second = await browser.screenshot('ws-1', worktree);

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
		browser.show('ws-1', { x: 40, y: 50, width: 300, height: 200 });
		browser.hide('ws-1');
		await browser.open('ws-1', 'https://example.com');

		await browser.screenshot('ws-1', worktree);

		expect(viewAt(0).bounds.slice(-2)).toEqual([
			{ x: -364, y: 0, width: 300, height: 200 },
			{ x: 40, y: 50, width: 300, height: 200 },
		]);
		expect(viewAt(0).visibility).toEqual([true, false]);
	});

	it('clicks for the agent and says so when nothing matches', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.click('ws-1', '#buy')).rejects.toThrow(NOTHING_OPEN);
		await browser.open('ws-1', 'https://example.com');

		await expect(browser.click('ws-1', '#buy')).resolves.toEqual({
			url: 'https://example.com/',
			title: 'Title of https://example.com/',
		});
		viewAt(0).contents.clickOutcome = 'missing';
		await expect(browser.click('ws-1', '#gone')).rejects.toThrow(
			'Nothing on the page matches `#gone`.',
		);
		viewAt(0).contents.clickOutcome = 'invalid';
		await expect(browser.click('ws-1', '[')).rejects.toThrow('`[` is not a valid CSS selector.');
	});

	it('keeps one pick per view: a new pick or a cancel ends the open one', async () => {
		const { browser, viewAt, window } = setup();
		await expect(browser.pick('ws-1')).rejects.toThrow('Open a page before picking an element.');
		await browser.open('ws-1', 'https://example.com');

		const first = browser.pick('ws-1');
		const second = browser.pick('ws-1');
		await expect(first).resolves.toBeNull();
		browser.cancelPick('ws-1');
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
