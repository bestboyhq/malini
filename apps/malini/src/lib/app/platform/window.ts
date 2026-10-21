import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import {
	APP_CLOSE_REQUESTED_CHANNEL,
	APP_CONNECT_REPOSITORY_REQUESTED_CHANNEL,
	APP_NOTIFICATION_OPENED_CHANNEL,
	APP_SCALE_CHANGED_CHANNEL,
	type ConnectRepositoryRequest,
	type NotificationTarget,
} from '$contract/events';
import type { NotificationPermissionResult } from '$contract/system';
import type { EventBus } from '$main/events';
import type { ShellHost } from './shell-host';

export type { NotificationPermissionResult };

export const WINDOW_STATE_FILE = 'main-window-state.json';

export const NO_MAIN_WINDOW_ERROR = 'the main window is not open';
export const NOTIFICATIONS_UNSUPPORTED_ERROR = 'notifications are not supported on this system';

export interface MainWindowState {
	x: number;
	y: number;
	width: number;
	height: number;
	zoomFactor?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value);
}

function isZoomFactor(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isValidWindowState(value: unknown): value is MainWindowState {
	if (!isRecord(value)) return false;
	const { x, y, width, height, zoomFactor } = value;
	return (
		isInteger(x) &&
		isInteger(y) &&
		isInteger(width) &&
		isInteger(height) &&
		width > 0 &&
		height > 0 &&
		(zoomFactor === undefined || isZoomFactor(zoomFactor))
	);
}

export async function readMainWindowState(appDataRoot: string): Promise<MainWindowState | null> {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(join(appDataRoot, WINDOW_STATE_FILE), 'utf8'),
		);
		return isValidWindowState(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function saveMainWindowState(
	appDataRoot: string,
	state: MainWindowState,
): Promise<void> {
	if (!isValidWindowState(state)) return;
	await mkdir(appDataRoot, { recursive: true });
	await writeFile(join(appDataRoot, WINDOW_STATE_FILE), JSON.stringify(state, null, 2));
}

const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 60;

export function showsOnADisplay(
	bounds: MainWindowState,
	workAreas: readonly MainWindowState[],
): boolean {
	return workAreas.some((area) => {
		const width =
			Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
		const height =
			Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
		return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT;
	});
}

export type ShellWindow = Pick<
	BrowserWindow,
	| 'show'
	| 'focus'
	| 'isMinimized'
	| 'restore'
	| 'isDestroyed'
	| 'destroy'
	| 'getContentSize'
	| 'getBounds'
	| 'setBounds'
	| 'on'
> & {
	readonly webContents: Pick<
		BrowserWindow['webContents'],
		'setZoomFactor' | 'getZoomFactor' | 'on' | 'reload'
	>;
};

export interface WindowDeps {
	getMainWindow(): ShellWindow | null;
	host: Pick<
		ShellHost,
		| 'notificationsSupported'
		| 'showNotification'
		| 'openMainWindow'
		| 'onWindowCreated'
		| 'onBeforeQuit'
		| 'onDisplayMetricsChanged'
		| 'displayWorkAreas'
	>;
	events: EventBus;
	appDataRoot: string;
}

export interface WindowCommands {
	focusMainWindow(): void;
	setInterfaceScale(args: { scale: number }): void;
	logicalViewport(): { width: number; height: number };
	setCloseGuard(args: { armed: boolean }): void;
	destroy(): void;
	notify(args: { options: { title: string; body: string; opens?: NotificationTarget } }): void;
	takeNotificationTarget(): NotificationTarget | null;
	requestConnectRepository(via: ConnectRepositoryRequest['via']): void;
	takeConnectRepositoryRequest(): ConnectRepositoryRequest | null;
	isNotificationPermissionGranted(): boolean | null;
	requestNotificationPermission(): NotificationPermissionResult;
	windowStateSaved(): Promise<void>;
	readonly closeGuardArmed: boolean;
}

export const CRASH_RELOAD_COOLDOWN_MS = 30_000;

export function createWindowCommands(deps: WindowDeps): WindowCommands {
	const { host, events } = deps;
	let armed = false;
	let quitting = false;
	const attached = new WeakSet<ShellWindow>();

	const requireWindow = (): ShellWindow => {
		const window = deps.getMainWindow();
		if (!window || window.isDestroyed()) throw new Error(NO_MAIN_WINDOW_ERROR);
		return window;
	};

	let unsavedState: MainWindowState | null = null;
	let stateSaving: Promise<void> | null = null;

	const saveLatestState = async (): Promise<void> => {
		for (let state = unsavedState; state !== null; state = unsavedState) {
			unsavedState = null;
			try {
				await saveMainWindowState(deps.appDataRoot, state);
			} catch (error) {
				console.error('failed to save the main window state', error);
			}
		}
		stateSaving = null;
	};

	const attach = (window: ShellWindow): void => {
		if (attached.has(window)) return;
		attached.add(window);
		let zoomFactor = window.webContents.getZoomFactor();
		const restore = async () => {
			const state = await readMainWindowState(deps.appDataRoot);
			if (!state || window.isDestroyed()) return;
			if (state.zoomFactor !== undefined) {
				zoomFactor = state.zoomFactor;
				window.webContents.setZoomFactor(zoomFactor);
			}
			const { x, y, width, height } = state;
			if (showsOnADisplay(state, host.displayWorkAreas()))
				window.setBounds({ x, y, width, height });
		};
		void restore();
		// ponytail: zoom is saved with the next move, resize or close, so a main-process crash forgets a zoom change made since; save on the zoom menu items if that bites
		const persist = () => {
			if (window.isDestroyed()) return;
			unsavedState = { ...window.getBounds(), zoomFactor: window.webContents.getZoomFactor() };
			stateSaving ??= saveLatestState();
		};
		const keepZoom = () => {
			if (!window.isDestroyed()) window.webContents.setZoomFactor(zoomFactor);
		};
		window.webContents.on('did-start-navigation', () => {
			zoomFactor = window.webContents.getZoomFactor();
		});
		window.webContents.on('did-navigate-in-page', keepZoom);
		window.on('resize', persist);
		window.on('move', persist);
		window.on('close', (event) => {
			persist();
			if (!armed || quitting || deps.getMainWindow() !== window) return;
			event.preventDefault();
			events.emit(APP_CLOSE_REQUESTED_CHANNEL, {});
		});
		let lastCrashReload = Number.NEGATIVE_INFINITY;
		window.webContents.on('render-process-gone', (_event, details) => {
			armed = false;
			if (quitting || window.isDestroyed() || details?.reason === 'clean-exit') return;
			if (Date.now() - lastCrashReload < CRASH_RELOAD_COOLDOWN_MS) return;
			lastCrashReload = Date.now();
			window.webContents.reload();
		});
		window.webContents.on('did-navigate', () => {
			armed = false;
			keepZoom();
		});
	};

	host.onWindowCreated(attach);
	host.onBeforeQuit(() => {
		quitting = true;
	});
	host.onDisplayMetricsChanged(() => events.emit(APP_SCALE_CHANGED_CHANNEL, {}));

	let notificationTarget: NotificationTarget | null = null;
	let connectRepositoryRequest: ConnectRepositoryRequest | null = null;

	const focusMainWindow = (): void => {
		const window = deps.getMainWindow();
		if (!window || window.isDestroyed()) {
			host.openMainWindow();
			return;
		}
		window.show();
		if (window.isMinimized()) window.restore();
		window.focus();
	};

	return {
		get closeGuardArmed() {
			return armed;
		},
		focusMainWindow,
		setInterfaceScale(args) {
			const scale = args?.scale;
			if (!isZoomFactor(scale)) {
				throw new Error('interface scale must be a positive number');
			}
			const window = requireWindow();
			window.webContents.setZoomFactor(scale);
			events.emit(APP_SCALE_CHANGED_CHANNEL, {});
		},
		logicalViewport() {
			const [width = 0, height = 0] = requireWindow().getContentSize();
			return { width, height };
		},
		setCloseGuard(args) {
			if (typeof args?.armed !== 'boolean') throw new Error('armed must be a boolean');
			const window = deps.getMainWindow();
			if (window) attach(window);
			armed = args.armed;
		},
		destroy() {
			const window = deps.getMainWindow();
			if (!window || window.isDestroyed()) return;
			armed = false;
			window.destroy();
		},
		notify(args) {
			const options = args?.options;
			if (typeof options?.title !== 'string' || typeof options?.body !== 'string') {
				throw new Error('notification needs a title and a body');
			}
			const opens = options.opens;
			if (
				opens !== undefined &&
				(typeof opens?.workstreamId !== 'string' || typeof opens?.sessionId !== 'string')
			) {
				throw new Error('a notification opens a workstream chat by its ids');
			}
			if (!host.notificationsSupported()) throw new Error(NOTIFICATIONS_UNSUPPORTED_ERROR);
			host.showNotification({
				title: options.title,
				body: options.body,
				...(opens
					? {
							onClick: () => {
								notificationTarget = {
									workstreamId: opens.workstreamId,
									sessionId: opens.sessionId,
								};
								focusMainWindow();
								events.emit(APP_NOTIFICATION_OPENED_CHANNEL, notificationTarget);
							},
						}
					: {}),
			});
		},
		takeNotificationTarget() {
			const target = notificationTarget;
			notificationTarget = null;
			return target;
		},
		requestConnectRepository(via) {
			connectRepositoryRequest = { via };
			focusMainWindow();
			events.emit(APP_CONNECT_REPOSITORY_REQUESTED_CHANNEL, connectRepositoryRequest);
		},
		takeConnectRepositoryRequest() {
			const request = connectRepositoryRequest;
			connectRepositoryRequest = null;
			return request;
		},
		isNotificationPermissionGranted: () => host.notificationsSupported(),
		requestNotificationPermission: () => (host.notificationsSupported() ? 'granted' : 'denied'),
		windowStateSaved: async () => {
			await stateSaving;
		},
	};
}
