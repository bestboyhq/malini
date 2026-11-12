import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserResizeRequest, BrowserState } from '$contract/browser';
import { BrowserDialogOpen } from '../browser.platform';
import { FULL_PAGE_MAX_HEIGHT, PREVIEW_LONG_EDGE } from './automation';
import type { PageContents, PageDialog, PageEvents, PageImage, PageView, Rectangle } from './page';
import type { PinAction, ThreadPin } from './thread-pins';
import {
	BrowserViews,
	DEFAULT_VIEW_SIZE,
	MAX_CONSOLE_LINES,
	MAX_CONSOLE_TEXT,
	NO_DIALOG,
	NOTHING_OPEN,
	RESIZE_ANSWER_MS,
	toDip,
} from './views';

const LOCATED = { x: 110, y: 220, rect: { x: 100, y: 1_200, width: 20, height: 40 } };
const FRAME_PLUMBING = new Set([
	'Page.getFrameTree',
	'Page.createIsolatedWorld',
	'Target.setAutoAttach',
]);

type DevtoolsListener = (
	event: unknown,
	method: string,
	params: unknown,
	sessionId: string,
) => void;
const PAGE_METRICS = {
	cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1_280, clientHeight: 800 },
	cssContentSize: { width: 1_280, height: 3_000 },
};
const CDP_PNG = Buffer.from('cdp png');

class FakeWindow {
	destroyed = false;
	onScreen = true;
	focused = true;
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

	isFocused(): boolean {
		return this.focused;
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
	loading = false;
	reloads = 0;
	readonly loads: string[] = [];
	readonly loadFailures: string[] = [];
	readonly scripts: string[] = [];
	readonly pinActions: unknown[] = [];
	actionOutcome: unknown = { ...LOCATED, done: true };
	readonly scriptOutcomes: unknown[] = [];
	throttled = true;
	devtoolsAnswer: (method: string, params?: object) => unknown = (method) =>
		method === 'Page.getLayoutMetrics'
			? PAGE_METRICS
			: method === 'Page.captureScreenshot'
				? { data: CDP_PNG.toString('base64') }
				: {};
	readonly devtoolsCommands: Array<readonly [string, object | undefined]> = [];
	readonly devtoolsListeners: DevtoolsListener[] = [];
	attachedCount = 0;
	readonly debugger = {
		isAttached: (): boolean => this.attachedCount > 0,
		attach: (): void => {
			this.attachedCount += 1;
		},
		sendCommand: async (method: string, params?: object): Promise<unknown> => {
			if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
			if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
			if (FRAME_PLUMBING.has(method)) return {};
			if (method === 'Runtime.evaluate' && params && 'contextId' in params) {
				const value = await this.runProgram(String(Reflect.get(params, 'expression')));
				const byValue = Reflect.get(params, 'returnByValue') !== false;
				return { result: byValue ? { value } : { objectId: 'node-1' } };
			}
			this.devtoolsCommands.push([method, params]);
			return this.devtoolsAnswer(method, params);
		},
		on: (_event: 'message', listener: DevtoolsListener): void => {
			this.devtoolsListeners.push(listener);
		},
	};
	static #nextProcessId = 4_000;
	readonly processId = FakeContents.#nextProcessId++;
	frame = new FakeImage(2_560, 1_600);
	captureFailure: Error | null = null;
	readonly unpainted: Array<PageImage | Error> = [];
	nextLoad: Promise<void> | null = null;
	readonly captured: string[] = [];
	readonly steps: string[] = [];
	readonly navigationHistory = {
		canGoBack: (): boolean => this.loads.length > 1,
		canGoForward: (): boolean => this.steps.includes('back'),
		goBack: (): void => void this.steps.push('back'),
		goForward: (): void => void this.steps.push('forward'),
	};

	async loadURL(url: string): Promise<void> {
		const landing = this.nextLoad;
		this.nextLoad = null;
		if (landing) {
			await landing;
			return this.loadURL(url);
		}
		this.loads.push(url);
		this.url = url;
		this.title = `Title of ${url}`;
		const failure = this.loadFailures.shift();
		return failure !== undefined
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
		return this.loading;
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
		this.captured.push(this.url);
		const unpainted = this.unpainted.shift();
		if (unpainted instanceof Error) return Promise.reject(unpainted);
		if (unpainted) return Promise.resolve(unpainted);
		if (this.captureFailure) return Promise.reject(this.captureFailure);
		return Promise.resolve(this.frame);
	}

	setBackgroundThrottling(allowed: boolean): void {
		this.throttled = allowed;
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
		if (code.includes('"kind":"end"') || code.includes('"kind":"show"'))
			return Promise.resolve(null);
		if (code.includes('"kind":"action"')) {
			return this.pinActions.length > 0
				? Promise.resolve(this.pinActions.shift())
				: new Promise(() => undefined);
		}
		return this.runProgram(code, false);
	}

	runProgram(code: string, record = true): Promise<unknown> {
		if (record) this.scripts.push(code);
		const queued = this.scriptOutcomes.length > 0;
		return Promise.resolve(queued ? this.scriptOutcomes.shift() : this.actionOutcome);
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
const PICK = {
	...TAB,
	provider: 'claude',
	model: 'claude-sonnet-5-5',
	models: [
		{
			id: 'claude-sonnet-5-5',
			label: 'Sonnet 5.5',
			provider: 'claude',
			providerName: 'Claude',
		},
	],
	profile: { effort: 'medium', mode: 'agent', access: 'auto', report: 'low' },
} as const;
const PAGE_PIN = {
	sessionId: 'session-1',
	domPath: 'main > p',
	prompt: 'Remove this line',
	status: 'working',
	outcome: null,
} as const;
const OTHER_TAB = { workstreamId: 'ws-2', tabId: 'tab-1' } as const;
const VISIBLE = { fullPage: false } as const;

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function inputs(contents: FakeContents): ReadonlyArray<readonly [string, object | undefined]> {
	return contents.devtoolsCommands.filter(([method]) => method.startsWith('Input.'));
}

function setup(zoom = 1) {
	let window: FakeWindow | null = new FakeWindow(zoom);
	const views: FakeView[] = [];
	const states: BrowserState[] = [];
	const opened: unknown[] = [];
	const closed: unknown[] = [];
	const resizes: BrowserResizeRequest[] = [];
	const resets = new Map<FakeWindow, () => void>();
	const threads: ThreadPin[] = [];
	const actions: Array<readonly [string, PinAction]> = [];
	const browser = new BrowserViews<FakeWindow>({
		getMainWindow: () => window,
		onScreen: (shown) => shown.onScreen,
		createView: (events) => {
			const view = new FakeView(events);
			views.push(view);
			return view;
		},
		imageFromPng: (png) =>
			png.equals(CDP_PNG) ? new FakeImage(2_560, 6_000) : new FakeImage(0, 0),
		watchRendererReset: (watched, reset) => {
			if (resets.has(watched)) throw new Error('watched the same window twice');
			resets.set(watched, reset);
		},
		workstreamExists: (workstreamId) => workstreamId.startsWith('ws-'),
		worktree: (workstreamId) => `/work/${workstreamId}`,
		stateChanged: (state) => states.push(state),
		tabOpened: (tab) => opened.push(tab),
		tabClosed: (tab) => closed.push(tab),
		resizeRequested: (request) => resizes.push(request),
		threads: (workstreamId) => (workstreamId === 'ws-1' ? threads : []),
		startThread: async () => 'session-1',
		threadAction: async (tab, action) => {
			actions.push([tab.tabId, action]);
		},
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
		closed,
		resizes,
		threads,
		actions,
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

	it('moves a shown view to new bounds without lifting it out of the window again', () => {
		const { browser, viewAt, window } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 300, height: 200 });
		browser.show(TAB, { x: 0, y: 0, width: 310, height: 200 });
		browser.show(TAB, { x: 0, y: 0, width: 320, height: 200 });

		expect(viewAt(0).placements).toEqual([
			[window(), 'back'],
			[window(), 'front'],
		]);
		expect(viewAt(0).bounds.at(-1)).toEqual({ x: 0, y: 0, width: 320, height: 200 });

		browser.hide(TAB);
		browser.show(TAB, { x: 0, y: 0, width: 320, height: 200 });
		expect(viewAt(0).placements.slice(-2)).toEqual([
			[window(), 'back'],
			[window(), 'front'],
		]);
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
				failure: null,
			},
		]);
		expect(browser.state(OTHER_TAB)).toMatchObject({ ...OTHER_TAB, url: '' });
	});

	it('recreates a view whose page died and reloads the address it showed', async () => {
		const { browser, views, viewAt } = setup();
		browser.navigate(TAB, 'http://localhost:5173/');
		viewAt(0).events.changed();
		viewAt(0).events.gone();
		expect(browser.state(TAB)).toMatchObject({ url: 'http://localhost:5173/', loading: false });

		await browser.reload(TAB);
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

	it('lists the page process, title and placement of every open tab and forgets a closed one', () => {
		const { browser, viewAt } = setup();
		const second = { ...TAB, tabId: 'tab-2' };
		browser.navigate(TAB, 'http://localhost:5173/');
		browser.navigate(second, 'https://music.example/');
		browser.show(second, { x: 0, y: 0, width: 300, height: 200 });
		expect(browser.tabProcesses()).toEqual([
			{
				processId: viewAt(0).contents.processId,
				title: 'Title of http://localhost:5173/',
				shown: false,
			},
			{
				processId: viewAt(1).contents.processId,
				title: 'Title of https://music.example/',
				shown: true,
			},
		]);

		browser.destroy(TAB);
		expect(browser.tabProcesses()).toEqual([
			{
				processId: viewAt(1).contents.processId,
				title: 'Title of https://music.example/',
				shown: true,
			},
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

	it('shows the agent its new tab even when the first page fails to load', async () => {
		const { browser, viewAt, opened } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		viewAt(0).contents.loadFailures.push('ERR_NAME_NOT_RESOLVED');

		await expect(browser.open(TAB, 'https://nowhere.example')).rejects.toThrow(
			'ERR_NAME_NOT_RESOLVED',
		);
		expect(opened).toEqual([TAB]);
	});

	it('closes the agent tab only after the page it is opening, then opens a fresh one', async () => {
		const { browser, views, viewAt, opened, closed } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		let land = (): void => undefined;
		viewAt(0).contents.nextLoad = new Promise((resolve) => (land = resolve));

		const opening = browser.open(TAB, 'https://example.com');
		const closing = browser.close(TAB);
		await expect.poll(() => opened).toEqual([TAB]);
		expect(viewAt(0).closed).toBe(false);
		expect(closed).toEqual([]);

		land();
		await expect(opening).resolves.toMatchObject({ url: 'https://example.com/' });
		await expect(closing).resolves.toBe(true);
		expect(viewAt(0).closed).toBe(true);
		expect(closed).toEqual([TAB]);
		expect(browser.state(TAB).url).toBe('');

		await browser.open(TAB, 'https://example.com/next');
		expect(views).toHaveLength(2);
		expect(opened).toEqual([TAB, TAB]);
	});

	it('tells malini a tab closed even when it has no page for it', async () => {
		const { browser, views, closed } = setup();

		await expect(browser.close(TAB)).resolves.toBe(false);

		expect(views).toHaveLength(0);
		expect(closed).toEqual([TAB]);
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

	it('reports a page that did not load, through every retry, until one loads', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-failed-'));
		roots.push(worktree);
		const { browser, states, viewAt } = setup();
		await browser.open(TAB, 'localhost:5173');
		viewAt(0).events.navigating('http://localhost:5173/');
		viewAt(0).events.failed('ERR_CONNECTION_REFUSED');

		const failed = 'http://localhost:5173/ did not load (ERR_CONNECTION_REFUSED).';
		expect(states.at(-1)).toMatchObject({ failure: 'ERR_CONNECTION_REFUSED' });
		await expect(browser.screenshot(TAB, worktree, VISIBLE)).rejects.toThrow(failed);
		await expect(browser.click(TAB, 'a')).rejects.toThrow(failed);
		viewAt(0).events.navigating('http://localhost:5173/');
		expect(browser.state(TAB)).toMatchObject({ failure: 'ERR_CONNECTION_REFUSED' });
		viewAt(0).events.committed();
		expect(browser.state(TAB)).toMatchObject({ failure: null });
		await expect(browser.screenshot(TAB, worktree, VISIBLE)).resolves.toMatchObject({
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
		const { scriptOutcomes } = viewAt(0).contents;
		scriptOutcomes.push(LOCATED, LOCATED, { problem: 'readonly' });
		await expect(browser.type(TAB, 'h1', 'x', false)).rejects.toThrow(
			'`h1` is not a field you can type into.',
		);
		scriptOutcomes.push(LOCATED, LOCATED, { problem: 'option', options: ['Monthly', 'Yearly'] });
		await expect(browser.type(TAB, 'select', 'Weekly', false)).rejects.toThrow(
			'`select` has no option "Weekly". Its options are: "Monthly", "Yearly".',
		);
		scriptOutcomes.push(LOCATED, LOCATED, { problem: 'format', kind: 'date' });
		await expect(browser.type(TAB, '#day', 'tomorrow', false)).rejects.toThrow(
			'`#day` is a date field and did not take "tomorrow". Use its format, for example 2026-11-12.',
		);
	});

	it('saves screenshots into the worktree sandbox with a small preview beside them', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-shots-'));
		roots.push(worktree);
		const { browser } = setup();
		await expect(browser.screenshot(TAB, worktree, VISIBLE)).rejects.toThrow(NOTHING_OPEN);
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		await expect(browser.screenshot(TAB, worktree, VISIBLE)).rejects.toThrow(NOTHING_OPEN);

		await browser.open(TAB, 'https://example.com');
		const first = await browser.screenshot(TAB, worktree, VISIBLE);
		const second = await browser.screenshot(TAB, worktree, VISIBLE);

		expect(first.path).toMatch(/^\.malini\/sandbox\/screenshots\/\d{4}-\d\d-\d\d-\d{6}\.png$/);
		expect(second.path).toMatch(/-\d{6}(?:-2)?\.png$/);
		expect(second.path).not.toBe(first.path);
		expect(first.url).toBe('https://example.com/');
		expect(readFileSync(join(worktree, first.path), 'utf8')).toBe('png 2560x1600');
		expect(first.previewPath).toBe(join(worktree, first.path.replace(/\.png$/, '.jpg')));
		expect(existsSync(first.previewPath)).toBe(true);
		expect(readFileSync(first.previewPath, 'utf8')).toBe(`jpeg ${PREVIEW_LONG_EDGE}x980 q80`);
	});

	it('lifts a hidden view out of the window while it captures it, then puts it back behind malini', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-hidden-'));
		roots.push(worktree);
		const { browser, viewAt, window } = setup();
		browser.show(TAB, { x: 40, y: 50, width: 300, height: 200 });
		browser.hide(TAB);
		await browser.open(TAB, 'https://example.com');

		await browser.screenshot(TAB, worktree, VISIBLE);

		expect(viewAt(0).removedFrom).toEqual([window()]);
		expect(viewAt(0).visibility).toEqual([true]);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(viewAt(0).bounds.at(-1)).toEqual({ x: 40, y: 50, width: 300, height: 200 });
	});

	it('captures a shown view in place, and out of the window while malini is hidden', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-shown-'));
		roots.push(worktree);
		const { browser, viewAt, window } = setup();
		browser.show(TAB, { x: 40, y: 50, width: 300, height: 200 });
		await browser.open(TAB, 'https://example.com');

		await browser.screenshot(TAB, worktree, VISIBLE);
		expect(viewAt(0).removedFrom).toEqual([]);

		window().onScreen = false;
		await browser.screenshot(TAB, worktree, VISIBLE);
		expect(viewAt(0).removedFrom).toEqual([window()]);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'front']);
	});

	it('waits for the first frame the page paints', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-first-frame-'));
		roots.push(worktree);
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		viewAt(0).contents.unpainted.push(new Error('UnknownVizError'), new FakeImage(0, 0));

		await expect(browser.screenshot(TAB, worktree, VISIBLE)).resolves.toMatchObject({
			url: 'https://example.com/',
		});
		expect(viewAt(0).contents.captured).toHaveLength(3);
	});

	it('tells the agent to reload a page that paints nothing', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			await browser.open(TAB, 'https://example.com');
			viewAt(0).contents.captureFailure = new Error('UnknownVizError');

			const outcome = expect(browser.screenshot(TAB, '/work/ws-1', VISIBLE)).rejects.toThrow(
				'The browser painted nothing for 3s. Call browser_reload',
			);
			await vi.advanceTimersByTimeAsync(3_100);
			await outcome;
		} finally {
			vi.useRealTimers();
		}
	});

	it('waits for the open the agent sent before a screenshot, also once the call before that open is done', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-turns-'));
		roots.push(worktree);
		const { browser, viewAt } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		await browser.open(TAB, 'https://example.com');
		let land = (): void => undefined;
		viewAt(0).contents.nextLoad = new Promise((resolve) => {
			land = resolve;
		});

		const opening = browser.open(TAB, 'https://example.org');
		await expect.poll(() => viewAt(0).contents.nextLoad).toBeNull();
		const shot = browser.screenshot(TAB, worktree, VISIBLE);
		land();

		await Promise.all([opening, shot]);
		expect(viewAt(0).contents.captured).toEqual(['https://example.org/']);
	});

	it('covers a shown page by copying its frame on screen and sending it behind malini in the same step', async () => {
		const { browser, viewAt, window } = setup();
		await browser.open(TAB, 'https://example.com');
		browser.show(TAB, { x: 40, y: 50, width: 300, height: 200 });

		const snapshot = browser.cover(TAB);

		expect(viewAt(0).contents.captured).toEqual(['https://example.com/']);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
		expect(await snapshot).toMatch(/^data:image\/jpeg;base64,/u);
		expect(viewAt(0).removedFrom).toEqual([]);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
	});

	it('has no snapshot when the compositor fails to copy a frame', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			await browser.open(TAB, 'https://example.com');
			viewAt(0).contents.captureFailure = new Error('UnknownVizError');

			const snapshot = browser.snapshot(TAB);
			await vi.advanceTimersByTimeAsync(3_100);
			expect(await snapshot).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('clicks with the mouse once the element holds still, with the hidden tab lifted out of the window', async () => {
		const { browser, viewAt, window } = setup();
		await expect(browser.click(TAB, '#buy')).rejects.toThrow(NOTHING_OPEN);
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);
		contents.scriptOutcomes.push({ ...LOCATED, x: 90 });

		await expect(browser.click(TAB, '#buy')).resolves.toEqual({
			url: 'https://example.com/',
			title: 'Title of https://example.com/',
		});

		expect(
			contents.scripts.filter((code) => code.includes('("#buy", "click", false)')),
		).toHaveLength(3);
		expect(contents.attachedCount).toBe(1);
		expect(contents.devtoolsCommands).toEqual([
			['Emulation.setFocusEmulationEnabled', { enabled: true }],
			['Page.enable', undefined],
			['Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }],
			[
				'Input.dispatchMouseEvent',
				{ type: 'mouseMoved', x: 110, y: 220, button: 'none', buttons: 0 },
			],
			[
				'Input.dispatchMouseEvent',
				{ type: 'mousePressed', x: 110, y: 220, button: 'left', buttons: 1, clickCount: 1 },
			],
			[
				'Input.dispatchMouseEvent',
				{ type: 'mouseReleased', x: 110, y: 220, button: 'left', buttons: 0, clickCount: 1 },
			],
			['Page.setInterceptFileChooserDialog', { enabled: false }],
			['Page.disable', undefined],
		]);
		expect(viewAt(0).removedFrom).toEqual([window()]);
		expect(viewAt(0).placements.at(-1)).toEqual([window(), 'back']);
	});

	it('refuses a click it can never land, without touching the mouse', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);

		contents.actionOutcome = { problem: 'invalid' };
		await expect(browser.click(TAB, 'button:has-text("Buy")')).rejects.toThrow(
			'`button:has-text("Buy")` is not a valid CSS selector or ref. Call browser_snapshot',
		);
		contents.actionOutcome = { problem: 'stale' };
		await expect(browser.click(TAB, '@e4')).rejects.toThrow(
			'`@e4` is a ref from an older snapshot, and its element is gone.',
		);
		contents.actionOutcome = { problem: 'popup', kind: 'select' };
		await expect(browser.click(TAB, '#plan')).rejects.toThrow(
			'`#plan` is a select, and a click opens its menu outside the page. Pick an option with browser_type',
		);
		contents.actionOutcome = { problem: 'popup', kind: 'date' };
		await expect(browser.click(TAB, '#day')).rejects.toThrow(
			'Set its value with browser_type instead, for example 2026-11-12.',
		);
		expect(inputs(contents)).toEqual([]);
	});

	it('waits up to 5s for an element to show and for what covers it to go', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			await browser.open(TAB, 'https://example.com');
			const { contents } = viewAt(0);

			contents.actionOutcome = { problem: 'missing' };
			const missing = expect(browser.click(TAB, '#gone')).rejects.toThrow(
				'Nothing on the page matches `#gone` within 5s. Call browser_snapshot',
			);
			await vi.advanceTimersByTimeAsync(5_100);
			await missing;

			contents.actionOutcome = { problem: 'covered', by: 'div.cookie-banner "Accept all"' };
			const covered = expect(browser.hover(TAB, '#menu')).rejects.toThrow(
				'div.cookie-banner "Accept all" covers `#menu`, so the mouse reaches it instead.',
			);
			await vi.advanceTimersByTimeAsync(5_100);
			await covered;
			expect(inputs(contents)).toEqual([]);

			contents.actionOutcome = { problem: 'missing' };
			const late = browser.click(TAB, '#late');
			await vi.advanceTimersByTimeAsync(1_000);
			contents.actionOutcome = LOCATED;
			await vi.advanceTimersByTimeAsync(1_000);
			await expect(late).resolves.toMatchObject({ url: 'https://example.com/' });
			expect(contents.devtoolsCommands.map(([, params]) => params)).toContainEqual(
				expect.objectContaining({ type: 'mousePressed' }),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('presses keys, hovers and scrolls with real input, with background throttling off', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);
		expect(contents.throttled).toBe(false);

		await browser.press(TAB, 'Shift+Tab');
		await browser.hover(TAB, '@e2');
		contents.scriptOutcomes.push(
			{ x: 0, y: 0, height: 3_000, viewport: { width: 1_280, height: 800 } },
			{ x: 0, y: 600, height: 3_000 },
			{ x: 0, y: 600, height: 3_000 },
		);
		await expect(browser.scroll(TAB, { x: 0, y: 600 })).resolves.toEqual({
			x: 0,
			y: 600,
			height: 3_000,
		});
		await expect(browser.press(TAB, 'Hyper+K')).rejects.toThrow(
			'`Hyper+K` is not a key Malini knows.',
		);

		const sent = contents.devtoolsCommands.map(([method, params]) => [
			method,
			params && 'type' in params ? params.type : undefined,
			params && 'key' in params ? params.key : undefined,
		]);
		expect(sent).toEqual([
			['Emulation.setFocusEmulationEnabled', undefined, undefined],
			['Page.enable', undefined, undefined],
			['Page.setInterceptFileChooserDialog', undefined, undefined],
			['Input.dispatchKeyEvent', 'rawKeyDown', 'Shift'],
			['Input.dispatchKeyEvent', 'rawKeyDown', 'Tab'],
			['Input.dispatchKeyEvent', 'keyUp', 'Tab'],
			['Input.dispatchKeyEvent', 'keyUp', 'Shift'],
			['Page.setInterceptFileChooserDialog', undefined, undefined],
			['Page.disable', undefined, undefined],
			['Input.dispatchMouseEvent', 'mouseMoved', undefined],
			['Input.dispatchMouseEvent', 'mouseWheel', undefined],
		]);
		expect(contents.devtoolsCommands.at(-1)).toEqual([
			'Input.dispatchMouseEvent',
			{ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 600 },
		]);
	});

	it('waits for text to show or an element to go, and says when it never does', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			await browser.open(TAB, 'https://example.com');
			const { contents } = viewAt(0);
			contents.actionOutcome = false;

			const shows = browser.wait(TAB, { seconds: 5, gone: false, text: 'Saved' });
			await vi.advanceTimersByTimeAsync(300);
			contents.actionOutcome = true;
			await vi.advanceTimersByTimeAsync(300);
			await expect(shows).resolves.toMatchObject({ url: 'https://example.com/' });

			const stays = expect(
				browser.wait(TAB, { seconds: 2, gone: true, selector: '.spinner' }),
			).rejects.toThrow('`.spinner` is still on the page after 2s.');
			await vi.advanceTimersByTimeAsync(2_200);
			await stays;

			contents.actionOutcome = 'stale';
			await expect(
				browser.wait(TAB, { seconds: 2, gone: true, selector: '@e9' }),
			).resolves.toMatchObject({ url: 'https://example.com/' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('runs a script the way the DevTools console does and returns its result as text', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);
		const evaluated: string[] = [];
		const threw = (className: string, description: string) => ({
			exceptionDetails: { exception: { className, description } },
		});
		contents.devtoolsAnswer = (method, params) => {
			if (method === 'Runtime.callFunctionOn') {
				return { result: { type: 'string', value: '["<a>"]' } };
			}
			if (method !== 'Runtime.evaluate' || !params || !('expression' in params)) return {};
			const expression = String(params.expression);
			evaluated.push(expression);
			if (expression === 'document.title') return { result: { type: 'string', value: 'Pricing' } };
			if (expression === '1 + 1') return { result: { type: 'number', value: 2 } };
			if (expression === 'return 3') {
				return threw('SyntaxError', 'SyntaxError: Illegal return statement');
			}
			if (expression.startsWith('(async () => {')) return { result: { type: 'number', value: 3 } };
			if (expression === 'boom()') {
				return threw('ReferenceError', 'ReferenceError: boom is not defined');
			}
			if (expression === 'document.links') return { result: { type: 'object', objectId: 'o-1' } };
			return { result: { type: 'undefined' } };
		};

		await expect(browser.evaluate(TAB, 'document.title')).resolves.toBe('Pricing');
		await expect(browser.evaluate(TAB, '1 + 1')).resolves.toBe('2');
		await expect(browser.evaluate(TAB, 'void 0')).resolves.toBe('undefined');
		await expect(browser.evaluate(TAB, 'return 3')).resolves.toBe('3');
		await expect(browser.evaluate(TAB, 'document.links')).resolves.toBe('["<a>"]');
		await expect(browser.evaluate(TAB, 'boom()')).rejects.toThrow(
			'The script threw ReferenceError: boom is not defined',
		);

		expect(evaluated).toEqual([
			'document.title',
			'1 + 1',
			'void 0',
			'return 3',
			'(async () => {\nreturn 3\n})()',
			'document.links',
			'boom()',
		]);
		expect(contents.devtoolsCommands).toContainEqual([
			'Runtime.callFunctionOn',
			expect.objectContaining({ objectId: 'o-1', returnByValue: true, awaitPromise: true }),
		]);
		expect(contents.devtoolsCommands.at(-1)).toEqual([
			'Runtime.releaseObjectGroup',
			{ objectGroup: 'malini' },
		]);
	});

	it('holds a dialog the page opens while the agent acts, until the agent answers it', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents, events } = viewAt(0);
		let release = (): void => undefined;
		const released = new Promise<object>((resolve) => {
			release = () => resolve({});
		});
		contents.devtoolsAnswer = (_method, params) =>
			params && 'type' in params && params.type === 'mouseReleased' ? released : {};
		const answers: boolean[] = [];
		const showToUser = vi.fn();
		const confirm: PageDialog = {
			type: 'confirm',
			message: 'Delete the draft?',
			answer: (accept) => {
				answers.push(accept);
				release();
			},
			showToUser,
		};

		const clicking = browser.click(TAB, '#delete');
		await expect.poll(() => inputs(contents)).toHaveLength(3);
		expect(events.leaving()).toBe(true);
		events.dialog(confirm);

		await expect(clicking).rejects.toThrow(
			'The page shows a confirm dialog and waits for an answer: "Delete the draft?". Call browser_dialog with accept true to press OK, or false to press Cancel.',
		);
		expect(events.leaving()).toBe(false);
		await expect(browser.readPage(TAB)).rejects.toBeInstanceOf(BrowserDialogOpen);
		await expect(browser.answerDialog(TAB, false)).resolves.toEqual({
			dialog: { type: 'confirm', message: 'Delete the draft?' },
			accepted: false,
			page: { url: 'https://example.com/', title: 'Title of https://example.com/' },
		});
		expect(answers).toEqual([false]);
		expect(showToUser).not.toHaveBeenCalled();
		await expect(browser.answerDialog(TAB, true)).rejects.toThrow(NO_DIALOG);
		await expect(browser.click(TAB, '#other')).resolves.toMatchObject({
			url: 'https://example.com/',
		});
	});

	it('shows the user a dialog on the tab they see, and holds one on a hidden tab until they open it', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { events } = viewAt(0);
		const shown: string[] = [];
		const alert = (message: string): PageDialog => ({
			type: 'alert',
			message,
			answer: () => undefined,
			showToUser: () => void shown.push(message),
		});
		const bounds = { x: 0, y: 0, width: 300, height: 200 };

		browser.show(TAB, bounds);
		events.dialog(alert('Saved'));
		expect(shown).toEqual(['Saved']);

		browser.hide(TAB);
		events.dialog(alert('Your session ends soon'));
		expect(shown).toEqual(['Saved']);
		await expect(browser.readPage(TAB)).rejects.toThrow(
			'The page shows an alert and waits for an answer: "Your session ends soon". Call browser_dialog to close it.',
		);
		browser.show(TAB, bounds);
		expect(shown).toEqual(['Saved', 'Your session ends soon']);
		await expect(browser.answerDialog(TAB, true)).rejects.toThrow(NO_DIALOG);

		browser.hide(TAB);
		events.dialog(alert('Left behind'));
		events.dialogsClosed();
		await expect(browser.readPage(TAB)).resolves.toBe('');
	});

	it('picks worktree files for a file field, or through the chooser a button opens', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-upload-'));
		roots.push(worktree);
		writeFileSync(join(worktree, 'cv.pdf'), 'pdf');
		writeFileSync(join(worktree, 'photo.png'), 'png');
		const cv = realpathSync(join(worktree, 'cv.pdf'));
		const photo = realpathSync(join(worktree, 'photo.png'));
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);
		const setFiles = () =>
			contents.devtoolsCommands.filter(([method]) => method === 'DOM.setFileInputFiles');

		await expect(browser.upload(TAB, worktree, '#cv', ['/etc/hosts'])).rejects.toThrow(
			'/etc/hosts is not a file in this worktree. Copy it into the worktree first',
		);
		await expect(browser.upload(TAB, worktree, '#cv', ['missing.pdf'])).rejects.toThrow(
			'missing.pdf is not a file in this worktree.',
		);

		contents.scriptOutcomes.push({ kind: 'input', multiple: false, disabled: false });
		await browser.upload(TAB, worktree, '#cv', ['cv.pdf']);
		contents.scriptOutcomes.push({ kind: 'input', multiple: false, disabled: false });
		await expect(browser.upload(TAB, worktree, '#cv', ['cv.pdf', 'photo.png'])).rejects.toThrow(
			'`#cv` takes one file, and you passed 2. Pick one.',
		);
		expect(setFiles()).toEqual([['DOM.setFileInputFiles', { files: [cv], objectId: 'node-1' }]]);

		const openChooser = (): void => {
			for (const listener of contents.devtoolsListeners) {
				listener(null, 'Page.fileChooserOpened', { backendNodeId: 42, mode: 'selectMultiple' }, '');
			}
		};
		contents.devtoolsAnswer = (_method, params) => {
			if (params && 'type' in params && params.type === 'mouseReleased') openChooser();
			return {};
		};
		contents.scriptOutcomes.push({ kind: 'other' });
		await browser.upload(TAB, worktree, '#attach', [cv, 'photo.png']);
		expect(setFiles().at(-1)).toEqual([
			'DOM.setFileInputFiles',
			{ files: [cv, photo], backendNodeId: 42 },
		]);

		await expect(browser.click(TAB, '#attach')).rejects.toThrow(
			'`#attach` opened a file chooser, and Malini closed it. Pick the files with browser_upload on `#attach` instead.',
		);
		expect(setFiles()).toHaveLength(2);
	});

	it('keeps the latest console messages of the page since it loaded, each clipped', async () => {
		const { browser, viewAt } = setup();
		await expect(browser.consoleLines(TAB)).rejects.toThrow(NOTHING_OPEN);
		await browser.open(TAB, 'https://example.com');
		const { events } = viewAt(0);

		events.console({ level: 'info', text: 'old page', source: '' });
		events.committed();
		events.console({ level: 'error', text: 'x'.repeat(MAX_CONSOLE_TEXT + 5), source: 'app.js:3' });
		await expect(browser.consoleLines(TAB)).resolves.toEqual({
			url: 'https://example.com/',
			lines: [{ level: 'error', text: `${'x'.repeat(MAX_CONSOLE_TEXT)}…`, source: 'app.js:3' }],
			dropped: 0,
		});

		for (let index = 0; index < MAX_CONSOLE_LINES + 2; index += 1) {
			events.console({ level: 'debug', text: `tick ${index}`, source: '' });
		}
		const { lines, dropped } = await browser.consoleLines(TAB);
		expect(lines).toHaveLength(MAX_CONSOLE_LINES);
		expect(dropped).toBe(3);
		expect(lines[0]?.text).toBe('tick 2');
		expect(lines.at(-1)?.text).toBe(`tick ${MAX_CONSOLE_LINES + 1}`);
	});

	it('captures the whole page or one element through DevTools, and says when the page is longer than one capture', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-full-page-'));
		roots.push(worktree);
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com');
		const { contents } = viewAt(0);

		const page = await browser.screenshot(TAB, worktree, { fullPage: true });
		const element = await browser.screenshot(TAB, worktree, { fullPage: false, selector: '@e3' });
		contents.devtoolsAnswer = (method) =>
			method === 'Page.getLayoutMetrics'
				? { ...PAGE_METRICS, cssContentSize: { width: 1_280, height: 20_000 } }
				: { data: CDP_PNG.toString('base64') };
		const long = await browser.screenshot(TAB, worktree, { fullPage: true });

		const clips = contents.devtoolsCommands
			.filter(([method]) => method === 'Page.captureScreenshot')
			.map(([, params]) => params);
		expect(clips).toEqual([
			{
				format: 'png',
				clip: { x: 0, y: 0, width: 1_280, height: 3_000, scale: 1 },
				captureBeyondViewport: true,
			},
			{
				format: 'png',
				clip: { x: 100, y: 1_200, width: 20, height: 40, scale: 1 },
				captureBeyondViewport: true,
			},
			{
				format: 'png',
				clip: { x: 0, y: 0, width: 1_280, height: FULL_PAGE_MAX_HEIGHT, scale: 1 },
				captureBeyondViewport: true,
			},
		]);
		expect(readFileSync(join(worktree, page.path), 'utf8')).toBe('png 2560x6000');
		expect(page).not.toHaveProperty('pageHeight');
		expect(element).not.toHaveProperty('pageHeight');
		expect(long.pageHeight).toBe(20_000);
		expect(contents.captured).toEqual([]);
	});

	it('keeps one pick per view: a new pick takes over the open one without handing focus or pins back in between, and a cancel ends it', async () => {
		const { browser, threads, viewAt, window } = setup();
		await expect(browser.pick(PICK)).rejects.toThrow('Open a page before picking an element.');
		threads.push({ ...PAGE_PIN, url: 'https://example.com/' });
		await browser.open(TAB, 'https://example.com');

		const scripts = (kind: string) =>
			viewAt(0).contents.scripts.filter((code) => code.includes(`"kind":"${kind}"`));
		const first = browser.pick(PICK);
		await expect.poll(() => scripts('select')).toHaveLength(1);
		const second = browser.pick(PICK);
		await expect(first).resolves.toBeNull();
		await expect.poll(() => scripts('select')).toHaveLength(2);
		expect(window().focusCount).toBe(0);
		expect(scripts('show')).toEqual([]);

		browser.cancelPick(TAB);
		await expect(second).resolves.toBeNull();
		expect(scripts('end')).toHaveLength(2);
		expect(window().focusCount).toBe(1);
		expect(scripts('show')).toHaveLength(1);
	});

	it('ends an open pick when the malini page reloads, since nothing is left to answer it', async () => {
		const { browser, viewAt, window, resetRenderer } = setup();
		await browser.open(TAB, 'https://example.com');
		const scripts = (kind: string) =>
			viewAt(0).contents.scripts.filter((code) => code.includes(`"kind":"${kind}"`));
		let ended = false;
		void (async () => {
			await browser.pick(PICK);
			ended = true;
		})();
		await expect.poll(() => scripts('select')).toHaveLength(1);

		resetRenderer(window());

		await expect.poll(() => ended).toBe(true);
		expect(scripts('end')).toHaveLength(1);
	});

	it('counts a blank page as a page, for the agent and for a pick alike', async () => {
		const worktree = mkdtempSync(join(tmpdir(), 'malini-browser-blank-'));
		roots.push(worktree);
		const { browser, opened, viewAt } = setup();
		await browser.open(TAB, 'about:blank');
		await browser.open(TAB, 'about:blank');
		expect(opened).toEqual([TAB]);
		await expect(browser.screenshot(TAB, worktree, VISIBLE)).resolves.toMatchObject({
			url: 'about:blank',
		});

		const selects = () =>
			viewAt(0).contents.scripts.filter((code) => code.includes('"kind":"select"'));
		const picking = browser.pick(PICK);
		await expect.poll(selects).toHaveLength(1);
		browser.cancelPick(TAB);
		await expect(picking).resolves.toBeNull();
	});

	it('opens a page that shows and then breaks off as a page that loaded', async () => {
		const { browser, viewAt } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 10, height: 10 });
		viewAt(0).contents.loadFailures.push('');

		await expect(browser.open(TAB, 'https://example.com/partial')).resolves.toMatchObject({
			url: 'https://example.com/partial',
		});
	});

	it('reports the page a tab is heading to while it loads, and the page it still shows once that load stops', async () => {
		const { browser, viewAt } = setup();
		await browser.open(TAB, 'https://example.com/');
		const { contents, events } = viewAt(0);
		events.failed('ERR_CONNECTION_RESET');

		contents.loading = true;
		events.navigating('https://example.com/back');
		expect(browser.state(TAB)).toMatchObject({
			url: 'https://example.com/back',
			loading: true,
			failure: null,
		});
		contents.loading = false;
		events.changed();
		expect(browser.state(TAB)).toMatchObject({
			url: 'https://example.com/',
			loading: false,
			failure: 'ERR_CONNECTION_RESET',
		});

		contents.loading = true;
		events.navigating('https://example.com/');
		expect(browser.state(TAB)).toMatchObject({ failure: 'ERR_CONNECTION_RESET' });
		contents.loading = false;
		events.changed();

		contents.nextLoad = new Promise(() => undefined);
		browser.navigate(TAB, 'example.com/typed');
		contents.loading = true;
		expect(browser.state(TAB)).toMatchObject({ url: 'https://example.com/typed', failure: null });
	});

	it('gives up on a page that never answers a click, so the next call on the tab still runs', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			await browser.open(TAB, 'https://example.com');
			viewAt(0).contents.actionOutcome = new Promise(() => undefined);
			let clicked: unknown = null;
			browser.click(TAB, 'button').catch((error: unknown) => {
				clicked = error;
			});
			const next = browser.open(TAB, 'https://example.com/next');

			await vi.advanceTimersByTimeAsync(10_000);

			expect(clicked).toMatchObject({
				message:
					'The page did not answer within 10s. It may wait on a dialog or a busy script. Call browser_screenshot to see what it shows.',
			});
			await expect(next).resolves.toMatchObject({ url: 'https://example.com/next' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('picks without focusing anything while its window is in the background, since focusing activates the app', async () => {
		const { browser, viewAt, window } = setup();
		await browser.open(TAB, 'https://example.com');
		window().focused = false;

		const selects = () =>
			viewAt(0).contents.scripts.filter((code) => code.includes('"kind":"select"'));
		const picking = browser.pick(PICK);
		await expect.poll(selects).toHaveLength(1);
		browser.cancelPick(TAB);
		await expect(picking).resolves.toBeNull();

		expect(viewAt(0).contents.focused).toBe(false);
		expect(window().focusCount).toBe(0);
	});

	it('waits for a page still loading before it picks, and ends the pick quietly when that page fails', async () => {
		const { browser, viewAt } = setup();
		browser.show(TAB, { x: 0, y: 0, width: 100, height: 100 });
		const { contents, events } = viewAt(0);
		const selects = () => contents.scripts.filter((code) => code.includes('"kind":"select"'));
		contents.loading = true;

		const picking = browser.pick(PICK);
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(selects()).toEqual([]);
		contents.url = 'https://example.com/';
		contents.loading = false;
		await expect.poll(() => selects()).toHaveLength(1);
		browser.cancelPick(TAB);
		await expect(picking).resolves.toBeNull();

		contents.loading = true;
		const failing = browser.pick(PICK);
		events.failed('ERR_NAME_NOT_RESOLVED');
		contents.loading = false;
		await expect(failing).resolves.toBeNull();
		expect(selects()).toHaveLength(1);
	});

	it('pins the threads started on the page it shows, and hands back what the user does with one', async () => {
		const { browser, threads, actions, viewAt } = setup();
		threads.push(
			{ ...PAGE_PIN, url: 'https://example.com/#pricing' },
			{ ...PAGE_PIN, sessionId: 'session-2', url: 'https://example.com/other' },
		);
		await browser.open(TAB, 'https://example.com/');
		const { contents } = viewAt(0);
		contents.pinActions.push({ kind: 'open', sessionId: 'session-1' });

		browser.showThreads('ws-1');

		const shown = contents.scripts.filter((code) => code.includes('"kind":"show"'));
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain('"sessionId":"session-1"');
		expect(shown[0]).not.toContain('session-2');
		await expect.poll(() => actions).toEqual([['tab-1', { kind: 'open', sessionId: 'session-1' }]]);

		viewAt(0).events.navigating('https://example.com/next');
		threads.splice(0);
		browser.showThreads('ws-1');
		expect(contents.scripts.filter((code) => code.includes('"kind":"show"'))).toHaveLength(1);
	});

	it('asks malini to resize a tab the user sees, then reports the width its page got', async () => {
		const { browser, resizes } = setup(1.25);
		browser.show(TAB, { x: 0, y: 0, width: 400, height: 600 });
		await browser.open(TAB, 'https://example.com');

		const resizing = browser.resize(TAB, 1_000);
		await expect.poll(() => resizes).toEqual([{ ...TAB, requestId: '1', width: 800 }]);
		browser.show(TAB, { x: 0, y: 0, width: 720, height: 600 });
		browser.resized('2');
		browser.resized('1');

		await expect(resizing).resolves.toEqual({ width: 900, height: 750 });
	});

	it('sizes a tab the user does not see as asked, and says when malini is hidden with the tab open', async () => {
		const { browser, resizes, window, viewAt } = setup();
		await expect(browser.resize(TAB, 1_000)).rejects.toThrow(NOTHING_OPEN);
		browser.show(TAB, { x: 0, y: 0, width: 640, height: 600 });
		await browser.open(TAB, 'https://example.com');
		browser.hide(TAB);
		const view = viewAt(0);
		view.contents.scriptOutcomes.push({ width: 390, height: 844 }, { width: 1_000, height: 844 });
		view.visibility.splice(0);

		await expect(browser.resize(TAB, 390, 844)).resolves.toEqual({ width: 390, height: 844 });
		expect(view.bounds.at(-1)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
		expect(view.visibility).toEqual([true, false]);
		await expect(browser.resize(TAB, 1_000)).resolves.toEqual({ width: 1_000, height: 844 });

		browser.show(TAB, { x: 0, y: 0, width: 640, height: 600 });
		window().onScreen = false;
		await expect(browser.resize(TAB, 1_000)).rejects.toThrow(
			"Malini's window is minimized or hidden while the user has the browser tab open, so its size did not change: the page is 640px wide.",
		);
		expect(resizes).toEqual([]);
	});

	it('says so when a page the user does not see keeps its old size', async () => {
		vi.useFakeTimers();
		try {
			const { browser, viewAt } = setup();
			browser.show(TAB, { x: 0, y: 0, width: 640, height: 600 });
			await browser.open(TAB, 'https://example.com');
			browser.hide(TAB);
			viewAt(0).contents.actionOutcome = { width: 640, height: 600 };

			const resizing = expect(browser.resize(TAB, 390, 844)).rejects.toThrow(
				'The page stayed 640 by 600px instead of 390 by 844px. Call browser_resize again.',
			);
			await vi.advanceTimersByTimeAsync(2_000);
			await resizing;
			expect(viewAt(0).visibility.at(-1)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up on a resize malini never answers', async () => {
		vi.useFakeTimers();
		try {
			const { browser } = setup();
			browser.show(TAB, { x: 0, y: 0, width: 640, height: 600 });
			await browser.open(TAB, 'https://example.com');

			const resizing = expect(browser.resize(TAB, 1_000)).rejects.toThrow(
				'Malini did not resize the browser tab within 5s. Call browser_resize again.',
			);
			await vi.advanceTimersByTimeAsync(RESIZE_ANSWER_MS);
			await resizing;
		} finally {
			vi.useRealTimers();
		}
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
