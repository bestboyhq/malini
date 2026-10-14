import { session, WebContentsView, type BrowserWindow, type Session } from 'electron';
import type { PageEvents, PageView } from './page';
import { isAllowedUrl } from './url';

export const BROWSER_PARTITION = 'persist:malini-browser';
const MAX_FAVICON_BYTES = 64 * 1024;

export function createElectronView(events: PageEvents): PageView<BrowserWindow> {
	denyPermissions();
	const view = new WebContentsView({
		webPreferences: {
			partition: BROWSER_PARTITION,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			webviewTag: false,
		},
	});
	const contents = view.webContents;
	contents.on('will-navigate', (event) => {
		if (!isAllowedUrl(event.url)) event.preventDefault();
	});
	contents.on('will-redirect', (event) => {
		if (event.isMainFrame && !isAllowedUrl(event.url)) event.preventDefault();
	});
	contents.setWindowOpenHandler(({ url }) => {
		if (isAllowedUrl(url)) void contents.loadURL(url).catch(() => undefined);
		return { action: 'deny' };
	});
	contents.on('did-start-loading', () => events.changed());
	contents.on('did-stop-loading', () => events.changed());
	contents.on('did-navigate', () => events.changed());
	contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
		if (isMainFrame) events.changed();
	});
	contents.on('page-title-updated', () => events.changed());
	contents.on('did-start-navigation', (details) => {
		if (details.isMainFrame && !details.isSameDocument) events.navigating();
	});
	let pageVisit = 0;
	contents.on('did-navigate', () => {
		pageVisit += 1;
		events.favicon(null);
	});
	contents.on('page-favicon-updated', async (_event, favicons) => {
		const visit = pageVisit;
		const favicon = await faviconDataUrl(contents.session, favicons[0]);
		if (visit === pageVisit && !contents.isDestroyed()) events.favicon(favicon);
	});
	contents.on('render-process-gone', () => events.gone());
	contents.on('destroyed', () => events.gone());
	return {
		contents,
		setBounds: (bounds) => view.setBounds(bounds),
		setBorderRadius: (radius) => view.setBorderRadius(radius),
		placeIn: (window, layer) => {
			window.contentView.addChildView(view, layer === 'front' ? undefined : 0);
			view.setVisible(layer === 'front');
		},
		setVisible: (visible) => view.setVisible(visible),
		removeFrom: (window) => window.contentView.removeChildView(view),
		close: () => {
			if (!contents.isDestroyed()) contents.close();
		},
	};
}

export function watchRendererReset(window: BrowserWindow, reset: () => void): void {
	window.webContents.on('did-start-navigation', (details) => {
		if (details.isMainFrame && !details.isSameDocument) reset();
	});
	window.webContents.on('render-process-gone', () => reset());
}

async function faviconDataUrl(partition: Session, url: string | undefined): Promise<string | null> {
	if (!url || !/^(?:https?|data):/u.test(url)) return null;
	try {
		const response = await partition.fetch(url);
		const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
		if (!response.ok || !type.startsWith('image/')) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES) return null;
		return `data:${type};base64,${bytes.toString('base64')}`;
	} catch {
		return null;
	}
}

function denyPermissions(): void {
	const partition = session.fromPartition(BROWSER_PARTITION);
	partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	partition.setPermissionCheckHandler(() => false);
}
