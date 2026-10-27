import {
	app,
	BrowserWindow,
	clipboard,
	ClipboardItem,
	Menu,
	nativeTheme,
	Notification,
	safeStorage,
	screen,
	shell,
	Tray,
	type MenuItemConstructorOptions,
	type Rectangle,
} from 'electron';
import type { AgentTheme } from '$contract/agent';
import type { ThemeMode } from '$contract/commands';
import { BACKGROUND_WINDOW, createMainWindow } from '$main/window';
import { aboutPanel } from './menu';

const LIVE_NOTIFICATION_LIMIT = 32;

const liveNotifications = new Set<Notification>();

let tray: Tray | null = null;

export type TrayItem = Readonly<{ label: string; click: () => void } | { type: 'separator' }>;

function holdUntilSettled(notification: Notification): void {
	const release = (): void => {
		liveNotifications.delete(notification);
	};
	notification.on('click', release);
	notification.on('close', release);
	notification.on('failed', release);
	liveNotifications.add(notification);
	for (const oldest of liveNotifications) {
		if (liveNotifications.size <= LIVE_NOTIFICATION_LIMIT) break;
		liveNotifications.delete(oldest);
	}
}

export interface ShellHost {
	readonly productName: string;
	readonly executablePath: string;
	openExternal(url: string): Promise<void>;
	clipboardWriteText(text: string, html?: string): Promise<void> | void;
	clipboardWriteImage(png: Buffer): Promise<void>;
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
	notificationsSupported(): boolean;
	showNotification(options: { title: string; body: string; onClick?: () => void }): void;
	openMainWindow(): void;
	showTray(icon: string, items: readonly TrayItem[]): void;
	showApplicationMenu(template: readonly MenuItemConstructorOptions[]): void;
	onWindowCreated(listener: (window: BrowserWindow) => void): void;
	onBeforeQuit(listener: () => void): void;
	onDisplayMetricsChanged(listener: () => void): void;
	displayWorkAreas(): readonly Rectangle[];
	followThemeMode(mode: ThemeMode): void;
	theme(): AgentTheme;
}

export function createElectronShellHost(): ShellHost {
	return {
		productName: app.getName(),
		executablePath: process.execPath,
		openExternal: (url) => shell.openExternal(url),
		clipboardWriteText: (text, html) =>
			html === undefined
				? clipboard.writeText(text)
				: clipboard.write([new ClipboardItem({ 'text/plain': text, 'text/html': html })]),
		clipboardWriteImage: (png) =>
			clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]),
		isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
		encryptString: (plainText) => safeStorage.encryptString(plainText),
		decryptString: (encrypted) => safeStorage.decryptString(encrypted),
		notificationsSupported: () => Notification.isSupported(),
		showNotification: (options) => {
			const notification = new Notification({
				title: options.title,
				body: options.body,
				silent: true,
			});
			const onClick = options.onClick;
			if (onClick) notification.on('click', () => onClick());
			holdUntilSettled(notification);
			notification.show();
		},
		openMainWindow: () => {
			createMainWindow();
		},
		showTray: (icon, items) => {
			if (BACKGROUND_WINDOW) return;
			tray = new Tray(icon);
			tray.setToolTip(app.getName());
			tray.setContextMenu(Menu.buildFromTemplate([...items]));
		},
		showApplicationMenu: (template) => {
			app.setAboutPanelOptions(aboutPanel(app.getName(), app.getVersion()));
			Menu.setApplicationMenu(Menu.buildFromTemplate([...template]));
		},
		onWindowCreated: (listener) => {
			app.on('browser-window-created', (_event, window) => listener(window));
		},
		onBeforeQuit: (listener) => {
			app.on('before-quit', () => listener());
		},
		onDisplayMetricsChanged: (listener) => {
			screen.on('display-metrics-changed', () => listener());
		},
		displayWorkAreas: () => screen.getAllDisplays().map(({ workArea }) => workArea),
		followThemeMode: (mode) => {
			nativeTheme.themeSource = mode;
		},
		theme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
	};
}
