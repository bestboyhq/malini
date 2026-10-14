import {
	app,
	BrowserWindow,
	clipboard,
	ClipboardItem,
	Notification,
	safeStorage,
	screen,
	shell,
} from 'electron';

const LIVE_NOTIFICATION_LIMIT = 32;

const liveNotifications = new Set<Notification>();

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
	onWindowCreated(listener: (window: BrowserWindow) => void): void;
	onBeforeQuit(listener: () => void): void;
	onDisplayMetricsChanged(listener: () => void): void;
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
		onWindowCreated: (listener) => {
			app.on('browser-window-created', (_event, window) => listener(window));
		},
		onBeforeQuit: (listener) => {
			app.on('before-quit', () => listener());
		},
		onDisplayMetricsChanged: (listener) => {
			screen.on('display-metrics-changed', () => listener());
		},
	};
}
