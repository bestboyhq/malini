import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const created: FakeBrowserWindow[] = [];

class FakeBrowserWindow extends EventEmitter {
	destroyed = false;
	shown: string[] = [];
	contentsDestroyed = false;
	webContents = {
		setWindowOpenHandler: () => undefined,
		isDestroyed: () => this.contentsDestroyed,
	};
	visibilityChecks = 0;
	constructor() {
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

vi.mock('electron', () => ({ BrowserWindow: FakeBrowserWindow, shell: { openExternal: vi.fn() } }));

const { createMainWindow } = await import('./window');

describe('createMainWindow', () => {
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
});
