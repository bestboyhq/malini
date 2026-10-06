import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import type { MainContext } from '$main/context';
import { openDatabase } from '$main/db/driver';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { ShellHost } from './shell-host';
import type { SecretCipher } from './secrets';
import type { ShellWindow } from './window';

export interface FakeHost extends Omit<ShellHost, 'executablePath'> {
	executablePath: string;
	opened: string[];
	clipboard: string[];
	notifications: { title: string; body: string; onClick?: () => void }[];
	encryptionAvailable: boolean;
	notificationsAvailable: boolean;
	windowCreated: ((window: BrowserWindow) => void)[];
	beforeQuit: (() => void)[];
	displayMetricsChanged: (() => void)[];
}

export function createFakeCipher(): SecretCipher & { available: boolean } {
	const cipher = {
		available: true,
		isEncryptionAvailable: () => cipher.available,
		encryptString: (plainText: string) => Buffer.from(`enc:${[...plainText].reverse().join('')}`),
		decryptString: (encrypted: Buffer) => {
			const text = encrypted.toString();
			if (!text.startsWith('enc:')) throw new Error('not a fake ciphertext');
			return [...text.slice(4)].reverse().join('');
		},
	};
	return cipher;
}

export function createFakeHost(): FakeHost {
	const cipher = createFakeCipher();
	const host: FakeHost = {
		productName: 'malini',
		executablePath: process.execPath,
		opened: [],
		clipboard: [],
		notifications: [],
		encryptionAvailable: true,
		notificationsAvailable: true,
		windowCreated: [],
		beforeQuit: [],
		displayMetricsChanged: [],
		openExternal: async (url) => {
			host.opened.push(url);
		},
		clipboardWriteText: async (text) => {
			host.clipboard.push(text);
		},
		isEncryptionAvailable: () => host.encryptionAvailable,
		encryptString: cipher.encryptString,
		decryptString: cipher.decryptString,
		notificationsSupported: () => host.notificationsAvailable,
		showNotification: (options) => {
			host.notifications.push(options);
		},
		onWindowCreated: (listener) => {
			host.windowCreated.push(listener);
		},
		onBeforeQuit: (listener) => {
			host.beforeQuit.push(listener);
		},
		onDisplayMetricsChanged: (listener) => {
			host.displayMetricsChanged.push(listener);
		},
	};
	return host;
}

export interface FakeWindow {
	window: ShellWindow;
	emit(event: string): { preventDefault: () => void; defaultPrevented: boolean };
	emitWebContents(event: string, ...args: unknown[]): void;
	calls: string[];
	bounds: { x: number; y: number; width: number; height: number };
	zoom: number;
	minimized: boolean;
	destroyed: boolean;
}

function asShellWindow(window: unknown): ShellWindow;
function asShellWindow(window: unknown): unknown {
	return window;
}

export function asBrowserWindow(window: unknown): BrowserWindow;
export function asBrowserWindow(window: unknown): unknown {
	return window;
}

export function createFakeWindow(): FakeWindow {
	const emitter = new EventEmitter();
	const webContentsEmitter = new EventEmitter();
	let fake: FakeWindow;
	let shellWindow: ShellWindow;
	shellWindow = asShellWindow({
		show: () => {
			fake.calls.push('show');
		},
		focus: () => {
			fake.calls.push('focus');
		},
		isMinimized: () => fake.minimized,
		restore: () => {
			fake.calls.push('restore');
			fake.minimized = false;
		},
		isDestroyed: () => fake.destroyed,
		destroy: () => {
			fake.calls.push('destroy');
			fake.destroyed = true;
		},
		getContentSize: (): [number, number] => [fake.bounds.width, fake.bounds.height],
		getBounds: () => ({ ...fake.bounds }),
		setBounds: (bounds: Partial<FakeWindow['bounds']>) => {
			fake.calls.push('setBounds');
			fake.bounds = { ...fake.bounds, ...bounds };
		},
		on: (event: string, listener: (...args: unknown[]) => void) => {
			emitter.on(event, listener);
			return shellWindow;
		},
		webContents: {
			setZoomFactor: (zoom: number) => {
				fake.zoom = zoom;
			},
			getZoomFactor: () => fake.zoom,
			reload: () => {
				fake.calls.push('reload');
			},
			on: (event: string, listener: (...args: unknown[]) => void) => {
				webContentsEmitter.on(event, listener);
				return shellWindow.webContents;
			},
		},
	});
	fake = {
		calls: [],
		bounds: { x: 10, y: 20, width: 1280, height: 800 },
		zoom: 1,
		minimized: false,
		destroyed: false,
		emit(event) {
			const payload = {
				defaultPrevented: false,
				preventDefault() {
					payload.defaultPrevented = true;
				},
			};
			emitter.emit(event, payload);
			return payload;
		},
		emitWebContents(event, ...args) {
			webContentsEmitter.emit(event, ...args);
		},
		window: shellWindow,
	};
	return fake;
}

export function createTestContext(
	appDataRoot: string,
	overrides: Partial<MainContext> = {},
): MainContext {
	return {
		db: openDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.1.0',
		...overrides,
	};
}
