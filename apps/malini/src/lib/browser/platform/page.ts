import type { BrowserConsoleLine, BrowserDialog } from '../browser.platform';

export const MALINI_WORLD_ID = 1_729;

export interface Rectangle {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface PageImage {
	isEmpty(): boolean;
	getSize(): { width: number; height: number };
	resize(options: { width?: number; height?: number; quality?: string }): PageImage;
	toPNG(): Buffer;
	toJPEG(quality: number): Buffer;
}

export interface PageContents {
	loadURL(url: string): Promise<void>;
	getURL(): string;
	getTitle(): string;
	isLoading(): boolean;
	isDestroyed(): boolean;
	isFocused(): boolean;
	getOSProcessId(): number;
	focus(): void;
	reload(): void;
	getZoomFactor(): number;
	readonly navigationHistory: {
		canGoBack(): boolean;
		canGoForward(): boolean;
		goBack(): void;
		goForward(): void;
	};
	capturePage(rect?: Rectangle, options?: { stayHidden?: boolean }): Promise<PageImage>;
	setBackgroundThrottling(allowed: boolean): void;
	readonly debugger: {
		isAttached(): boolean;
		attach(protocolVersion?: string): void;
		sendCommand(method: string, params?: object, sessionId?: string): Promise<unknown>;
		on(
			event: 'message',
			listener: (event: unknown, method: string, params: unknown, sessionId: string) => void,
		): unknown;
	};
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	executeJavaScriptInIsolatedWorld(
		worldId: number,
		scripts: Array<{ code: string }>,
		userGesture?: boolean,
	): Promise<unknown>;
}

export interface PageEvents {
	changed(): void;
	favicon(favicon: string | null): void;
	navigating(url: string): void;
	ready(): void;
	movedInPage(): void;
	committed(): void;
	failed(reason: string): void;
	console(line: BrowserConsoleLine): void;
	dialog(dialog: PageDialog): void;
	dialogsClosed(): void;
	leaving(): boolean;
	gone(): void;
}

export interface PageDialog extends BrowserDialog {
	answer(accept: boolean): void;
	showToUser(): void;
}

export interface HostWindow {
	isDestroyed(): boolean;
	isFocused(): boolean;
	readonly webContents: { getZoomFactor(): number; focus(): void };
}

export interface PageView<W extends HostWindow> {
	readonly contents: PageContents;
	setBounds(bounds: Rectangle): void;
	setBorderRadius(radius: number): void;
	placeIn(window: W, layer: 'front' | 'back'): void;
	setVisible(visible: boolean): void;
	removeFrom(window: W): void;
	close(): void;
}
