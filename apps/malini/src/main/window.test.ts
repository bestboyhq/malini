import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const created: FakeBrowserWindow[] = [];

class FakeBrowserWindow extends EventEmitter {
	destroyed = false;
	shown: string[] = [];
	contentsDestroyed = false;
	url = 'file:///renderer/index.html#/workstreams/ws-1';
	webContents = Object.assign(new EventEmitter(), {
		setWindowOpenHandler: () => undefined,
		isDestroyed: () => this.contentsDestroyed,
		getURL: () => this.url,
	});
	visibilityChecks = 0;
	constructor(readonly options: Record<string, unknown>) {
		super();
		for (const event of ['show', 'hide', 'minimize', 'maximize', 'restore']) {
			this.on(event, () => {
				if (this.destroyed || this.contentsDestroyed)
					throw new TypeError('Object has been destroyed');
				this.visibilityChecks += 1;
			});
		}
		created.push(this);
	}
	isDestroyed(): boolean {
		return this.destroyed;
	}
	show(): void {
		if (this.destroyed || this.contentsDestroyed) throw new TypeError('Object has been destroyed');
		this.shown.push('show');
	}
	showInactive(): void {
		if (this.destroyed || this.contentsDestroyed) throw new TypeError('Object has been destroyed');
		this.shown.push('showInactive');
	}
	loadFile(): Promise<void> {
		return Promise.resolve();
	}
	loadURL(): Promise<void> {
		return Promise.resolve();
	}
}

const openExternal = vi.fn();
const cursorDisplay = { workArea: { x: 1920, y: 25, width: 1920, height: 1055 } };
const screen = {
	getCursorScreenPoint: () => ({ x: 2400, y: 400 }),
	getDisplayNearestPoint: () => cursorDisplay,
};
vi.mock('electron', () => ({ BrowserWindow: FakeBrowserWindow, screen, shell: { openExternal } }));

const { createMainWindow } = await import('./window');

function navigator(window: FakeBrowserWindow): (url: string) => boolean {
	return (url) => {
		let prevented = false;
		window.webContents.emit('will-navigate', { preventDefault: () => (prevented = true) }, url);
		return prevented;
	};
}

function lastWindow(): FakeBrowserWindow {
	const window = created.at(-1);
	if (!window) throw new Error('no window was created');
	return window;
}

describe('createMainWindow', () => {
	it('opens centered on the display under the cursor, at most 1600 by 1000', () => {
		createMainWindow();
		expect(lastWindow().options).toMatchObject({ x: 2080, y: 53, width: 1600, height: 1000 });

		cursorDisplay.workArea = { x: 0, y: 37, width: 1470, height: 860 };
		createMainWindow();
		expect(lastWindow().options).toMatchObject({ x: 0, y: 37, width: 1470, height: 860 });
	});

	it('does not show a window that was destroyed before its first paint', () => {
		createMainWindow();
		const window = created.at(-1);
		if (!window) throw new Error('no window was created');
		window.destroyed = true;

		expect(() => window.emit('ready-to-show')).not.toThrow();
		expect(window.shown).toEqual([]);
	});

	it('does not show a window whose page is already torn down by a quit', () => {
		createMainWindow();
		const window = created.at(-1);
		if (!window) throw new Error('no window was created');
		window.contentsDestroyed = true;

		expect(() => window.emit('ready-to-show')).not.toThrow();
		expect(window.shown).toEqual([]);
	});

	it('keeps the visibility bookkeeping Electron does away from a window or page a quit tore down', () => {
		createMainWindow();
		const window = created.at(-1);
		if (!window) throw new Error('no window was created');
		window.emit('show');
		expect(window.visibilityChecks).toBe(1);

		window.contentsDestroyed = true;
		expect(() => window.emit('hide')).not.toThrow();
		window.destroyed = true;
		expect(() => window.emit('hide')).not.toThrow();
		expect(window.visibilityChecks).toBe(1);
	});

	it('never lets the app page navigate away, and hands web links to the browser', () => {
		createMainWindow();
		const window = created.at(-1);
		if (!window) throw new Error('no window was created');
		const navigate = navigator(window);

		expect(navigate(window.url)).toBe(true);
		expect(navigate('file:///workstreams/ws-1?agent=s-1')).toBe(true);
		expect(openExternal).not.toHaveBeenCalled();
		expect(navigate('https://github.com/szymeo/malini')).toBe(true);
		expect(openExternal).toHaveBeenCalledWith('https://github.com/szymeo/malini');
	});

	it('lets the dev server reload the page it serves, and nothing else', async () => {
		vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
		vi.resetModules();
		const { createMainWindow: createDevWindow } = await import('./window');
		vi.unstubAllEnvs();
		createDevWindow();
		const window = created.at(-1);
		if (!window) throw new Error('no window was created');
		window.url = 'http://localhost:5173/#/workstreams/ws-1';
		const navigate = navigator(window);

		expect(navigate('http://localhost:5173/#/workstreams/ws-1')).toBe(false);
		expect(navigate('http://localhost:5173/elsewhere')).toBe(true);
		expect(navigate('file:///workstreams/ws-1')).toBe(true);
	});
});
