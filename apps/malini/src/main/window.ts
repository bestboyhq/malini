import { join } from 'node:path';
import { BrowserWindow, screen, shell, type Rectangle } from 'electron';

export const BACKGROUND_WINDOW = process.env['MALINI_BACKGROUND_WINDOW'] === '1';
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];
const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1000;
Reflect.deleteProperty(process.env, 'ELECTRON_RENDERER_URL');

export function createMainWindow(): BrowserWindow {
	const window = new BrowserWindow({
		...(BACKGROUND_WINDOW
			? behindEverythingAtTheScreenEdge()
			: defaultWindowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea)),
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: 'Malini',
		titleBarStyle: 'hiddenInset',
		trafficLightPosition: { x: 12, y: 13 },
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			v8CacheOptions: 'bypassHeatCheck',
			zoomMode: 'isolated',
			...(BACKGROUND_WINDOW ? { backgroundThrottling: false } : {}),
		},
	});
	guardVisibilityListeners(window);
	if (BACKGROUND_WINDOW) stayInBackground(window);

	window.once('ready-to-show', () => {
		if (window.isDestroyed() || window.webContents.isDestroyed()) return;
		window.show();
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});
	window.webContents.on('will-navigate', (event, url) => {
		if (DEV_SERVER_URL && url === window.webContents.getURL()) return;
		event.preventDefault();
		if (isWebLink(url)) void shell.openExternal(url);
	});

	if (DEV_SERVER_URL) {
		void window.loadURL(DEV_SERVER_URL);
	} else {
		void window.loadFile(join(__dirname, '../renderer/index.html'));
	}

	return window;
}

function defaultWindowBounds(workArea: Rectangle): Rectangle {
	const width = Math.min(workArea.width, DEFAULT_MAX_WIDTH);
	const height = Math.min(workArea.height, DEFAULT_MAX_HEIGHT);
	return {
		x: workArea.x + Math.round((workArea.width - width) / 2),
		y: workArea.y + Math.round((workArea.height - height) / 2),
		width,
		height,
	};
}

function isWebLink(url: string): boolean {
	return /^https?:/u.test(url) && !(DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL));
}

function behindEverythingAtTheScreenEdge(): Rectangle & {
	type: 'desktop';
	enableLargerThanScreen: true;
} {
	const { bounds } = screen
		.getAllDisplays()
		.reduce((rightmost, display) =>
			display.bounds.x + display.bounds.width > rightmost.bounds.x + rightmost.bounds.width
				? display
				: rightmost,
		);
	return {
		type: 'desktop',
		x: bounds.x + bounds.width - 1,
		y: bounds.y,
		width: 1280,
		height: 800,
		enableLargerThanScreen: true,
	};
}

function stayInBackground(window: BrowserWindow): void {
	window.webContents.setAudioMuted(true);
	window.show = () => window.showInactive();
	window.focus = () => {};
}

const VISIBILITY_EVENTS = ['show', 'hide', 'minimize', 'maximize', 'restore'] as const;

// ponytail: Electron's own visibility listener reads the window and its page without checking either is alive, and a teardown can still fire these events; drop this once Electron guards it
function guardVisibilityListeners(window: BrowserWindow): void {
	const emitter: NodeJS.EventEmitter = window;
	for (const event of VISIBILITY_EVENTS) {
		for (const listener of emitter.listeners(event)) {
			emitter.removeListener(event, listener as (...args: unknown[]) => void);
			emitter.on(event, (...args: unknown[]) => {
				if (window.isDestroyed() || window.webContents.isDestroyed()) return;
				Reflect.apply(listener, window, args);
			});
		}
	}
}
