import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const BUILD = join(root, 'build');
export const IMAGE = join(root, 'src/lib/og.png');
export const SOURCE = join(root, 'src/lib/og-source.sha256');
export const COMMAND = 'pnpm --filter @malini/site generate:og-image';

const ORIGIN = 'https://bestboy.dev';
const VIEW = '/malini/og';
const KIT = '/malini/_app/immutable/';
const SIZE = { width: 1200, height: 630 };

const SITE_URL = /\/malini\/[\w./-]+?\.(?:css|js|woff2|webp|png|jpe?g|svg)\b/gu;
const STATIC_IMPORT = /\b(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/gu;
const DYNAMIC_IMPORT = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']/gu;
const HASHED_NAME = /(?<=[/.])[\w-]{8}(?=\.(?:css|js|woff2|webp|png|jpe?g|svg)\b)/gu;
const BOOT = /<script\b[\s\S]*?<\/script>|<link [^>]*rel="modulepreload"[^>]*>/gu;
const TEXT = /\.(?:html|css|js)$/u;

const READY = `(async () => {
	await document.fonts.ready;
	await Promise.all([...document.images].map((image) => image.decode()));
	const drawn = () => [...document.querySelectorAll('canvas')].every(
		(canvas) => canvas.width === Math.round(canvas.clientWidth * devicePixelRatio),
	);
	const deadline = performance.now() + 20000;
	while (!drawn()) {
		if (performance.now() > deadline) throw new Error('a canvas never drew');
		await new Promise(requestAnimationFrame);
	}
})()`;

function imports(path: string, text: string, pattern: RegExp): string[] {
	return Array.from(text.matchAll(pattern), ([, specifier = '']) =>
		posix.join(posix.dirname(path), specifier),
	);
}

function closure(start: readonly string[], next: (path: string) => readonly string[]): string[] {
	const seen = new Set<string>();
	const visit = (path: string): void => {
		if (seen.has(path)) return;
		seen.add(path);
		for (const reference of next(path)) visit(reference);
	};
	for (const path of start) visit(path);
	return [...seen];
}

export function readOgView(): { source: string; loads: Set<string> } {
	const read = (path: string): Buffer => readFileSync(join(BUILD, path));
	const text = (path: string): string => read(path).toString('utf8');
	const references = (path: string): string[] => {
		if (!TEXT.test(path)) return [];
		const content = text(path);
		const urls = Array.from(content.matchAll(SITE_URL), ([url]) => url);
		if (!path.endsWith('.js')) return urls;
		return [
			...imports(path, content, STATIC_IMPORT),
			...imports(path, content, DYNAMIC_IMPORT),
			...urls,
		];
	};
	const page = `${VIEW}.html`;
	const html = text(page);
	const direct = references(page);
	const rootError = readdirSync(join(BUILD, KIT, 'nodes'))
		.filter((name) => name.startsWith('1.'))
		.map((name) => `${KIT}nodes/${name}`);
	const kit = new Set(
		closure([...direct.filter((path) => path.startsWith(`${KIT}entry/`)), ...rootError], (path) =>
			imports(path, text(path), STATIC_IMPORT),
		),
	);
	const own = closure(
		direct.filter((path) => !kit.has(path)),
		(path) => references(path).filter((reference) => !kit.has(reference)),
	);
	const { version }: { version: string } = JSON.parse(text('/malini/_app/version.json'));
	const normalize = (content: string): string =>
		content
			.replaceAll(version, '')
			.replace(/__sveltekit_\w+/gu, '__sveltekit')
			.replace(HASHED_NAME, '');
	const hash = createHash('sha256').update(normalize(html.replace(BOOT, '')));
	for (const path of own) {
		hash.update(`\0${normalize(path)}\0`);
		hash.update(TEXT.test(path) ? normalize(text(path)) : read(path));
	}
	return { source: hash.digest('hex'), loads: new Set([page, ...kit, ...own]) };
}

async function render(): Promise<void> {
	const { app, BrowserWindow, net, session } = await import('electron');
	app.dock?.hide();
	const watchdog = setTimeout(() => {
		console.error('the view took over a minute to render');
		app.exit(1);
	}, 60_000);
	try {
		await app.whenReady();
		const view = readOgView();
		const requested = new Set<string>();
		const og = session.fromPartition('og-image');
		og.protocol.handle('https', (request) => {
			const { origin, pathname } = new URL(request.url);
			const path = posix.extname(pathname) ? pathname : `${pathname}.html`;
			requested.add(`${origin}${path}`);
			const file = join(BUILD, path);
			return origin === ORIGIN && existsSync(file)
				? net.fetch(pathToFileURL(file).href)
				: new Response(null, { status: 404 });
		});
		const window = new BrowserWindow({
			...SIZE,
			show: false,
			useContentSize: true,
			webPreferences: { offscreen: true, session: og },
		});
		await window.loadURL(`${ORIGIN}${VIEW}`);
		await window.webContents.executeJavaScript(READY);
		let image = await window.webContents.capturePage();
		for (let tries = 0; ; tries++) {
			await sleep(150);
			const next = await window.webContents.capturePage();
			if (next.toPNG().equals(image.toPNG())) break;
			if (tries === 20) throw new Error('the view never settled into one frame');
			image = next;
		}
		const unhashed = [...requested].filter(
			(url) => !url.startsWith(ORIGIN) || !view.loads.has(url.slice(ORIGIN.length)),
		);
		if (unhashed.length > 0) {
			throw new Error(`the view loaded ${unhashed.join(', ')}, which its source hash misses`);
		}
		const { width, height } = image.getSize();
		if (width !== SIZE.width || height !== SIZE.height) {
			throw new Error(`the view rendered at ${width}x${height}, not ${SIZE.width}x${SIZE.height}`);
		}
		writeFileSync(IMAGE, image.toPNG());
		writeFileSync(SOURCE, `${view.source}\n`);
		console.log(`Rendered src/lib/og.png from ${view.loads.size} files, source ${view.source}`);
		app.quit();
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		clearTimeout(watchdog);
	}
}

if (process.versions.electron) void render();
