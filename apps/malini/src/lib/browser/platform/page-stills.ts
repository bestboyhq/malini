import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nativeTheme, WebContentsView, type BrowserWindow } from 'electron';
import { captureFrame, within } from './automation';
import { MALINI_WORLD_ID } from './page';

const PAGE_WIDTH = 1_280;
const PAGE_HEIGHT = 800;
const STILL_WIDTH = 640;
const STILL_QUALITY = 85;
const LOAD_MS = 10_000;
const SETTLE_MS = 2_000;
// ponytail: a fixed pause after the fonts lets most entrance motion end; a page that moves in for longer is caught mid-motion
const SETTLE = 'document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 400)))';

export type PageStills = Readonly<{
	still(pageUrl: string, file: string): Promise<Buffer | null>;
	forget(workstreamId: string): Promise<void>;
}>;

export function pageStills(root: string, getWindow: () => BrowserWindow | null): PageStills {
	// ponytail: one capture at a time, so a long chat fills its thumbnails one after another; run a few at once if that feels slow
	let queue: Promise<unknown> = Promise.resolve();
	const capturing = new Map<string, Promise<Buffer | null>>();

	const capture = async (path: string, pageUrl: string, turn: Promise<unknown>) => {
		try {
			await turn;
			const still = await shoot(pageUrl, getWindow());
			if (still === null) return null;
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, still);
			return still;
		} finally {
			capturing.delete(path);
		}
	};

	const queued = (path: string, pageUrl: string): Promise<Buffer | null> => {
		const running = capture(path, pageUrl, queue);
		capturing.set(path, running);
		queue = running.catch(() => null);
		return running;
	};

	return {
		async still(pageUrl, file) {
			const name = createHash('sha256')
				.update(`${pageUrl}\u0000${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}`)
				.digest('hex');
			const path = join(root, new URL(pageUrl).hostname, `${name}.jpg`);
			// ponytail: a still is fresh while it is newer than its page file, so a page that changes only through its stylesheet or scripts keeps the old still; compare its folder's newest file if that bites
			const [page, kept] = await Promise.all([stat(file), stat(path).catch(() => null)]);
			if (kept !== null && kept.mtimeMs >= page.mtimeMs) return readFile(path);
			return capturing.get(path) ?? queued(path, pageUrl);
		},
		forget: (workstreamId) =>
			rm(join(root, workstreamId.toLowerCase()), { recursive: true, force: true }),
	};
}

async function shoot(pageUrl: string, window: BrowserWindow | null): Promise<Buffer | null> {
	if (window === null || window.isDestroyed()) return null;
	const view = new WebContentsView({
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			webviewTag: false,
		},
	});
	const contents = view.webContents;
	contents.setAudioMuted(true);
	contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	contents.on('will-navigate', (event) => event.preventDefault());
	view.setBounds({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
	view.setVisible(false);
	window.contentView.addChildView(view, 0);
	try {
		await within(contents.loadURL(pageUrl), LOAD_MS);
		await within(
			contents.executeJavaScriptInIsolatedWorld(MALINI_WORLD_ID, [{ code: SETTLE }]),
			SETTLE_MS,
		);
		const image = await captureFrame(contents);
		return image && image.resize({ width: STILL_WIDTH, quality: 'good' }).toJPEG(STILL_QUALITY);
	} finally {
		if (!window.isDestroyed()) window.contentView.removeChildView(view);
		contents.close();
	}
}
