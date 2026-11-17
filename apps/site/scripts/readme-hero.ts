import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const BUILD = join(root, 'build');
const README = join(root, '../../.github/readme');
const ORIGIN = 'https://bestboy.dev';
const PAGE = '/malini';
const VIEW = { width: 1280, height: 1100 };
const SCALE = 1.5;
const HEADER = 100;
const STEP = 40;
const REST = '~/.claude/CLAUDE.md';
const GLIDES = 3;
const WARM_LOOPS = 2;
const SETTLED = 60;
const BLEND = 20;
const SEAM = 0.03;
const QUIET = 0.005;
const QUALITY = 78;
const SETTLED_QUALITY = 97;
const BLOCK = 8;
const THEMES = [
	['dark', 'hero.webp'],
	['light', 'hero-light.webp'],
] as const;

const HERO = '[data-place="hero"]';

const CLOCK = `{
	const paint = requestAnimationFrame.bind(window);
	const watch = new MutationObserver(() => {});
	watch.observe(document, { childList: true, subtree: true });
	let now = 0;
	let frame = 0;
	let queue = [];
	let handle = 0;
	let every = 0;
	let since = -1;
	const shows = [];
	const rests = [];
	requestAnimationFrame = (callback) => (queue.push([++handle, callback]), handle);
	cancelAnimationFrame = (id) => {
		queue = queue.filter(([queued]) => queued !== id);
	};
	performance.now = () => now;
	const shown = () =>
		watch
			.takeRecords()
			.flatMap(({ addedNodes }) => [...addedNodes])
			.find((node) => node.classList?.contains('hot'))?.textContent ?? null;
	const rest = () => {
		const stage = document.querySelector('${HERO} .stage');
		for (let click = 0; click < 12; click++) {
			stage.click();
			if (shown() === '${REST}') return;
		}
		throw new Error('the loupe never came back to its rest step');
	};
	window.clock = {
		rests,
		advance(count) {
			for (let index = 0; index < count; index++) {
				frame++;
				now += ${STEP};
				const due = queue;
				queue = [];
				for (const [, callback] of due) callback(now);
				const text = shown();
				if (text !== null) {
					shows.push(frame);
					if (shows.length === 3) every = shows[2] - shows[1];
					if (text === '${REST}') rests.push(frame);
					since = text === '${REST}' ? 0 : since < 0 ? -1 : since + 1;
				}
				if (every && since === ${GLIDES - 1} && frame === shows.at(-1) + every - 1) {
					rest();
					shows.push(frame);
					rests.push(frame);
					since = 0;
				}
			}
			return frame;
		},
		spin(at, loop) {
			const frame = document.querySelector('${HERO} .stage iframe');
			for (const animation of [document, frame.contentDocument].flatMap((root) => root.getAnimations())) {
				const { duration, iterations } = animation.effect.getTiming();
				if (iterations !== Infinity || typeof duration !== 'number') continue;
				animation.pause();
				animation.currentTime = (at / loop) * Math.max(1, Math.round(loop / duration)) * duration;
			}
		},
		painted: () => new Promise((done) => paint(() => paint(() => done(frame)))),
	};
}`;

const SETTLE = `(async () => {
	await document.fonts.ready;
	const hero = document.querySelector('${HERO}');
	const frame = () => hero.querySelector('.stage iframe');
	const running = (root) =>
		root.getAnimations().some(
			(animation) =>
				animation.playState === 'running' &&
				animation.effect.getTiming().iterations !== Infinity &&
				(root !== document || hero.contains(animation.effect.target)),
		);
	const deadline = Date.now() + 30000;
	while (
		!frame()?.classList.contains('ready') ||
		running(document) ||
		running(frame().contentDocument) ||
		hero.querySelector('[aria-busy="true"]')
	) {
		if (Date.now() > deadline) throw new Error('the hero never settled');
		window.clock?.advance(1);
		await new Promise((done) => setTimeout(done, 16));
	}
	const plate = hero.querySelector('.plate > .gl');
	scrollTo(0, plate.getBoundingClientRect().top + scrollY - ${HEADER});
	const { x, y, width, height } = plate.getBoundingClientRect();
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
})()`;

type Rect = { x: number; y: number; width: number; height: number };

function serve(session: Electron.Session, net: Electron.Net, still: boolean): void {
	session.protocol.handle('https', (request) => {
		const { origin, pathname } = new URL(request.url);
		const file = [pathname, `${pathname}.html`, `${pathname}/index.html`]
			.map((path) => join(BUILD, path))
			.find((path) => existsSync(path) && statSync(path).isFile());
		if (origin !== ORIGIN || !file) return new Response(null, { status: 404 });
		if (still || file !== join(BUILD, PAGE, 'index.html'))
			return net.fetch(pathToFileURL(file).href);
		const html = readFileSync(file, 'utf8').replace('<head>', `<head><script>${CLOCK}</script>`);
		return new Response(html, { headers: { 'content-type': 'text/html' } });
	});
}

async function settledCapture(
	contents: Electron.WebContents,
	rect: Rect,
): Promise<Electron.NativeImage> {
	let image = await contents.capturePage(rect);
	for (let tries = 0; tries < 20; tries++) {
		const next = await contents.capturePage(rect);
		if (next.toBitmap().equals(image.toBitmap())) return next;
		image = next;
	}
	throw new Error('a frame never settled');
}

const numbered = (prefix: string, index: number): string =>
	`${prefix}-${String(index).padStart(4, '0')}.png`;

async function record(
	window: Electron.BrowserWindow,
	rect: Rect,
	folder: string,
): Promise<{ takes: string[]; loop: number }> {
	const run = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script);
	let rests: number[] = [];
	while (rests.length <= WARM_LOOPS) {
		await run('clock.advance(24)');
		rests = await run<number[]>('clock.rests');
	}
	const loop = (rests.at(-1) ?? 0) - (rests.at(-2) ?? 0);
	const start = (rests.at(-1) ?? 0) + SETTLED;
	await run(`clock.advance(${start - (await run<number>('clock.advance(0)'))})`);
	const takes: string[] = [];
	for (let index = 0; index < loop + BLEND; index++) {
		await run(
			`clock.advance(1); clock.spin(${(index % loop) * STEP}, ${loop * STEP}); clock.painted()`,
		);
		const take = join(folder, numbered('take', index));
		writeFileSync(take, (await settledCapture(window.webContents, rect)).toPNG());
		takes.push(take);
	}
	return { takes, loop };
}

type Block = { rows: number[]; span: number };

function blocks(width: number, height: number): Block[] {
	const all: Block[] = [];
	for (let y = 0; y < height; y += BLOCK) {
		for (let x = 0; x < width; x += BLOCK) {
			const length = Math.min(BLOCK, height - y);
			const rows = Array.from({ length }, (_, row) => ((y + row) * width + x) * 4);
			all.push({ rows, span: Math.min(BLOCK, width - x) * 4 });
		}
	}
	return all;
}

const encoderTolerance = (quality: number): number =>
	Math.round(31 - 30 * Math.sqrt(quality / 100));

function moved(from: Buffer, to: Buffer, tolerance: number): (block: Block) => boolean {
	const differs = (byte: number): boolean =>
		byte % 4 !== 3 && Math.abs((from[byte] ?? 0) - (to[byte] ?? 0)) > tolerance;
	return ({ rows, span }) =>
		rows.some((row) => {
			for (let byte = row; byte < row + span; byte++) if (differs(byte)) return true;
			return false;
		});
}

export function hold(shown: Buffer, frame: Buffer, width: number, quality: number): void {
	const all = blocks(width, shown.length / 4 / width);
	for (const { rows, span } of all.filter(moved(shown, frame, encoderTolerance(quality)))) {
		for (const row of rows) frame.copy(shown, row, row, row + span);
	}
}

export function* closeLoop(
	read: (index: number) => Buffer,
	loop: number,
	width: number,
): Generator<{ frame: Buffer; quality: number }> {
	const head = read(0);
	const all = blocks(width, head.length / 4 / width);
	const seam = all.filter(moved(head, read(loop), encoderTolerance(QUALITY))).length;
	if (seam > all.length * SEAM) {
		throw new Error(`the loop does not close: ${seam} blocks differ where it wraps`);
	}
	let shown: Buffer | undefined;
	let last = head;
	let moving = true;
	for (let index = 0; index < loop; index++) {
		const frame = read(index);
		if (index < BLEND) {
			const from = read(loop + index);
			const k = (index + 1) / (BLEND + 1);
			for (let byte = 0; byte < frame.length; byte++) {
				frame[byte] = Math.round((from[byte] ?? 0) * (1 - k) + (frame[byte] ?? 0) * k);
			}
		}
		const quiet = all.filter(moved(last, frame, 0)).length < all.length * QUIET;
		const quality = !shown || (quiet && moving) || index === loop - 1 ? SETTLED_QUALITY : QUALITY;
		moving = !quiet;
		last = Buffer.from(frame);
		if (shown) hold(shown, frame, width, quality);
		else shown = frame;
		yield { frame: shown, quality };
	}
}

async function loopFrames(
	takes: readonly string[],
	loop: number,
	folder: string,
): Promise<{ file: string; quality: number }[]> {
	const { nativeImage } = await import('electron');
	const read = (index: number): Buffer => nativeImage.createFromPath(takes[index] ?? '').toBitmap();
	const size = nativeImage.createFromPath(takes[0] ?? '').getSize();
	const frames: { file: string; quality: number }[] = [];
	for (const { frame, quality } of closeLoop(read, loop, size.width)) {
		const file = join(folder, numbered('frame', frames.length));
		writeFileSync(file, nativeImage.createFromBitmap(frame, size).toPNG());
		frames.push({ file, quality });
	}
	console.log(`Looped ${loop} frames of ${size.width}x${size.height}, ${(loop * STEP) / 1000} s`);
	return frames;
}

function encode(frames: readonly { file: string; quality: number }[], out: string): void {
	execFileSync(
		'img2webp',
		[
			...['-loop', '0', '-kmin', '0', '-sharp_yuv', '-lossy', '-m', '6', '-d', String(STEP)],
			...frames.flatMap(({ file, quality }) => ['-q', String(quality), file]),
			...['-o', out],
		],
		{ stdio: 'inherit' },
	);
}

async function render(): Promise<void> {
	const { app, BrowserWindow, nativeTheme, net, session } = await import('electron');
	const still = process.argv.includes('--still');
	app.dock?.hide();
	if (still) app.commandLine.appendSwitch('force-prefers-reduced-motion');
	try {
		await app.whenReady();
		const partition = session.fromPartition('readme-hero');
		serve(partition, net, still);
		for (const [theme, name] of THEMES) {
			nativeTheme.themeSource = theme;
			const window = new BrowserWindow({
				...VIEW,
				show: false,
				useContentSize: true,
				webPreferences: {
					offscreen: { deviceScaleFactor: SCALE },
					session: partition,
					backgroundThrottling: false,
				},
			});
			await window.loadURL(`${ORIGIN}${PAGE}`);
			const rect: Rect = await window.webContents.executeJavaScript(SETTLE);
			const out = join(README, name);
			const folder = mkdtempSync(join(tmpdir(), 'readme-hero-'));
			try {
				if (still) {
					const frame = join(folder, 'still.png');
					writeFileSync(frame, (await settledCapture(window.webContents, rect)).toPNG());
					execFileSync('cwebp', ['-quiet', '-sharp_yuv', '-q', '90', '-m', '6', frame, '-o', out]);
				} else {
					const { takes, loop } = await record(window, rect, folder);
					encode(await loopFrames(takes, loop, folder), out);
				}
			} finally {
				rmSync(folder, { recursive: true, force: true });
				window.destroy();
			}
			console.log(`Wrote .github/readme/${name}, ${(statSync(out).size / 1e6).toFixed(2)} MB`);
		}
		app.quit();
	} catch (error) {
		console.error(error);
		app.exit(1);
	}
}

if (process.versions.electron) void render();
