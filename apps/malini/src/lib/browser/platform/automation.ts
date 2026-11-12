import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isErrnoException } from '$main/errors';
import { isInsideDirectory } from '$main/fs/paths';
import { SANDBOX_SCRATCH_PATH } from '$main/git/paths';
import type {
	BrowserScreenshotFile,
	BrowserScreenshotPart,
	BrowserScrollPosition,
	BrowserSize,
	BrowserWait,
} from '../browser.platform';
import { keyPresses } from './keyboard';
import type { PageContents, PageImage, Rectangle } from './page';
import {
	FILE_INPUT_PROGRAM,
	LOCATE_PROGRAM,
	OWNER_PROGRAM,
	PRESENCE_PROGRAM,
	SCROLL_POSITION_PROGRAM,
	SERIALIZE_FUNCTION,
	SNAPSHOT_PROGRAM,
	TYPE_PROGRAM,
} from './page-programs';
import { isLocalUrl } from './url';

export const SCREENSHOTS_PATH = `${SANDBOX_SCRATCH_PATH}/screenshots`;
export const PREVIEW_LONG_EDGE = 1_568;
export const ACTION_WAIT_MS = 5_000;
export const FULL_PAGE_MAX_HEIGHT = 16_384;
export const MAX_RESULT_CHARS = 30_000;

const OPEN_TIMEOUT_MS = 20_000;
const SERVER_RETRY_MS = 500;
const REFUSED = 'ERR_CONNECTION_REFUSED';
export const ACTION_SETTLE_MS = 10_000;
const NAVIGATION_GRACE_MS = 250;
const LOAD_POLL_MS = 50;
const FIRST_FRAME_MS = 3_000;
const FRAME_POLL_MS = 50;
const MAX_NAME_ATTEMPTS = 1_000;
const BROKE_OFF_AFTER_COMMIT = '';
const PAGE_ANSWER_MS = 10_000;
const LOCATE_POLL_MS = 50;
const WAIT_POLL_MS = 100;
const SCROLL_POLL_MS = 100;
const SCROLL_SETTLE_MS = 2_000;
const RESIZE_SETTLE_MS = 2_000;
const VIEWPORT_PROGRAM = '() => ({ width: innerWidth, height: innerHeight })';
const EVALUATE_TIMEOUT_MS = 30_000;
const SNAPSHOT_MAX_LINES = 1_500;
const SNAPSHOT_MAX_CHARS = 40_000;
const OBJECT_GROUP = 'malini';
const DEVTOOLS_PROTOCOL = '1.3';
const WORLD_NAME = 'Malini';
const FRAME_REF = /^@f([0-9]+)(e[0-9]+)$/u;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
const SNAPSHOT_CUT =
	'… The page goes on. Read the rest with browser_evaluate, for example document.querySelector("main").innerText.';
const MAC = process.platform === 'darwin';
const FINAL_PROBLEMS = new Set(['invalid', 'stale', 'popup']);
const FORMATS: Readonly<Record<string, string>> = {
	date: '2026-11-12',
	'datetime-local': '2026-11-12T14:30',
	month: '2026-11',
	week: '2026-W46',
	time: '14:30',
	color: 'a hex color such as #rrggbb',
	range: '50',
};

type LocateMode = 'click' | 'hover' | 'see';

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Located extends Point {
	readonly rect: Rectangle;
	readonly frame: PageFrame;
	readonly target: string;
	readonly inner: Point;
}

interface PageFrame {
	readonly frameId: string;
	readonly session: string | undefined;
	readonly parent: PageFrame | null;
	readonly index: number;
}

interface Chooser {
	readonly backendNodeId: number;
	readonly multiple: boolean;
	readonly session: string | undefined;
}

interface Frames {
	readonly sessions: Map<string, string>;
	numbered: ReadonlyMap<number, PageFrame>;
	readonly choosers: Set<(chooser: Chooser) => void>;
}

const pageFrames = new WeakMap<PageContents, Frames>();

export async function openUrl(contents: PageContents, url: string): Promise<void> {
	const serverDeadline = Date.now() + OPEN_TIMEOUT_MS;
	const waitsForServer = isLocalUrl(url);
	let failure = await load(contents, url);
	while (failure === REFUSED && waitsForServer && Date.now() < serverDeadline) {
		await delay(SERVER_RETRY_MS);
		failure = await load(contents, url);
	}
	if (failure === REFUSED && waitsForServer) {
		throw new Error(
			`Could not open ${url}: nothing listened on that port for ${OPEN_TIMEOUT_MS / 1_000}s (${REFUSED}). Start the server, then open it again.`,
		);
	}
	if (failure !== null) throw new Error(`Could not open ${url}: ${failure}`);
}

async function load(contents: PageContents, url: string): Promise<string | null> {
	const deadline = Date.now() + OPEN_TIMEOUT_MS;
	try {
		await within(contents.loadURL(url), OPEN_TIMEOUT_MS);
	} catch (error) {
		const code = loadErrorCode(error);
		if (code !== 'ERR_ABORTED' && code !== BROKE_OFF_AFTER_COMMIT) return code ?? describe(error);
	}
	await settled(contents, deadline);
	return null;
}

export function pageLoaded(contents: PageContents): Promise<void> {
	return settled(contents, Date.now() + OPEN_TIMEOUT_MS);
}

export async function settleAfterAction(contents: PageContents): Promise<void> {
	await delay(NAVIGATION_GRACE_MS);
	await settled(contents, Date.now() + ACTION_SETTLE_MS);
}

export async function captureVisible(contents: PageContents): Promise<PageImage> {
	const image = await captureFrame(contents);
	if (!image) {
		throw new Error(
			`The browser painted nothing for ${FIRST_FRAME_MS / 1_000}s. Call browser_reload, then browser_screenshot again.`,
		);
	}
	return image;
}

export async function captureRegion(
	contents: PageContents,
	part: BrowserScreenshotPart,
): Promise<{ readonly png: Buffer; readonly pageHeight?: number }> {
	const element = part.selector === undefined ? null : await locate(contents, part.selector, 'see');
	const metrics = await devtools(contents, 'Page.getLayoutMetrics');
	const viewport = field(metrics, 'cssVisualViewport');
	const content = field(metrics, 'cssContentSize');
	const height = requireNumber(content, 'height');
	const visible = {
		x: requireNumber(viewport, 'pageX'),
		y: requireNumber(viewport, 'pageY'),
		width: requireNumber(viewport, 'clientWidth'),
		height: requireNumber(viewport, 'clientHeight'),
	};
	const clip = snapOut(
		element === null
			? {
					x: 0,
					y: 0,
					width: requireNumber(content, 'width'),
					height: Math.min(height, FULL_PAGE_MAX_HEIGHT),
				}
			: { ...element.rect, x: element.rect.x + visible.x, y: element.rect.y + visible.y },
	);
	const shot = await devtools(contents, 'Page.captureScreenshot', {
		format: 'png',
		clip: { ...clip, scale: 1 },
		captureBeyondViewport: !inside(clip, visible),
	});
	const png = Buffer.from(stringField(shot, 'data') ?? '', 'base64');
	if (png.length === 0) throw new Error('The browser returned an empty screenshot.');
	const cut = element === null && height > FULL_PAGE_MAX_HEIGHT;
	return cut ? { png, pageHeight: Math.round(height) } : { png };
}

export async function saveScreenshot(
	image: PageImage,
	url: string,
	worktree: string,
	now: Date,
): Promise<BrowserScreenshotFile> {
	const directory = join(worktree, SCREENSHOTS_PATH);
	await mkdir(directory, { recursive: true });
	const name = await writeUnique(directory, timestamp(now), image.toPNG());
	const previewPath = join(directory, `${name}.jpg`);
	await writeFile(previewPath, fitLongEdge(image, PREVIEW_LONG_EDGE).toJPEG(80));
	return { path: `${SCREENSHOTS_PATH}/${name}.png`, previewPath, url };
}

export async function readPage(contents: PageContents): Promise<string> {
	const numbered = new Map<number, PageFrame>();
	framesOf(contents).numbered = numbered;
	const room = { lines: SNAPSHOT_MAX_LINES, chars: SNAPSHOT_MAX_CHARS };
	const { lines, cut } = await frameLines(contents, await topFrame(contents), '', room, numbered);
	return [...lines, ...(cut ? [SNAPSHOT_CUT] : [])].join('\n');
}

async function frameLines(
	contents: PageContents,
	frame: PageFrame,
	prefix: string,
	room: { readonly lines: number; readonly chars: number },
	numbered: Map<number, PageFrame>,
): Promise<{ readonly lines: readonly string[]; readonly cut: boolean }> {
	const answer = await runInFrame(contents, frame, SNAPSHOT_PROGRAM, [
		room.lines,
		room.chars,
		prefix,
		frame.parent === null,
	]);
	const own = list(field(answer, 'lines')).filter((line) => typeof line === 'string');
	const owners = new Map(list(field(answer, 'frames')).map((owner) => [field(owner, 'at'), owner]));
	let cut = field(answer, 'cut') === true;
	let used = { lines: own.length, chars: charsOf(own) };
	const lines: string[] = [];
	for (const [at, line] of own.entries()) {
		lines.push(line);
		const owner = owners.get(at);
		if (owner === undefined) continue;
		const left = { lines: room.lines - used.lines, chars: room.chars - used.chars };
		if (left.lines <= 0 || left.chars <= 0) {
			cut = true;
			continue;
		}
		const child = await childFrame(contents, frame, requireNumber(owner, 'index')).catch(
			() => null,
		);
		if (child === null) continue;
		const number = numbered.size + 1;
		numbered.set(number, child);
		const inner = await frameLines(contents, child, `f${number}`, left, numbered).catch(() => null);
		if (inner === null) continue;
		const indent = '  '.repeat(requireNumber(owner, 'depth') + 1);
		const nested = inner.lines.map((each) => indent + each);
		lines.push(...nested);
		used = { lines: used.lines + nested.length, chars: used.chars + charsOf(nested) };
		cut ||= inner.cut;
	}
	return { lines, cut };
}

function charsOf(lines: readonly string[]): number {
	return lines.reduce((sum, line) => sum + line.length + 1, 0);
}

export async function clickTarget(contents: PageContents, target: string): Promise<void> {
	const point = await locate(contents, target, 'click');
	const { chooser } = await catchingChooser(contents, true, async () => {
		await pressAt(contents, point);
		await settleAfterAction(contents);
	});
	if (chooser !== null) {
		throw new Error(
			`\`${target}\` opened a file chooser, and Malini closed it. Pick the files with browser_upload on \`${target}\` instead.`,
		);
	}
}

export async function uploadFiles(
	contents: PageContents,
	target: string,
	files: readonly string[],
): Promise<void> {
	const fileInput = await fileField(contents, target);
	if (fileInput === null) {
		const point = await locate(contents, target, 'click');
		const { chooser } = await catchingChooser(contents, false, async () => {
			await pressAt(contents, point);
			await settleAfterAction(contents);
		});
		if (chooser === null) {
			throw new Error(
				`\`${target}\` is not a file field, and clicking it opened no file chooser. Call browser_snapshot to find the file field or the button that opens one.`,
			);
		}
		if (!chooser.multiple && files.length > 1) throw new Error(oneFile(target, files));
		await devtools(
			contents,
			'DOM.setFileInputFiles',
			{ files, backendNodeId: chooser.backendNodeId },
			chooser.session,
		);
	} else {
		if (fileInput.disabled) throw new Error(`\`${target}\` is disabled, so it takes no files.`);
		if (!fileInput.multiple && files.length > 1) throw new Error(oneFile(target, files));
		const { frame, local } = await frameOf(contents, target);
		const input = await evaluateInFrame(
			contents,
			frame,
			`(${FILE_INPUT_PROGRAM})(${JSON.stringify(local)}, true)`,
			false,
		);
		const objectId = stringField(field(input, 'result'), 'objectId');
		if (objectId === undefined) throw new Error(locateError(target, 'stale', null));
		try {
			await devtools(contents, 'DOM.setFileInputFiles', { files, objectId }, frame.session);
		} finally {
			void devtools(contents, 'Runtime.releaseObject', { objectId }, frame.session).catch(
				() => undefined,
			);
		}
	}
	await settleAfterAction(contents);
}

function oneFile(target: string, files: readonly string[]): string {
	return `\`${target}\` takes one file, and you passed ${files.length}. Pick one.`;
}

async function fileField(
	contents: PageContents,
	target: string,
): Promise<{ readonly multiple: boolean; readonly disabled: boolean } | null> {
	const { frame, local } = await frameOf(contents, target);
	const deadline = Date.now() + ACTION_WAIT_MS;
	for (;;) {
		const answer = await runInFrame(contents, frame, FILE_INPUT_PROGRAM, [local, false]);
		const problem = stringField(answer, 'problem');
		if (problem === undefined) {
			if (stringField(answer, 'kind') !== 'input') return null;
			return {
				multiple: field(answer, 'multiple') === true,
				disabled: field(answer, 'disabled') === true,
			};
		}
		if (FINAL_PROBLEMS.has(problem) || Date.now() >= deadline) {
			throw new Error(locateError(target, problem, answer));
		}
		await delay(LOCATE_POLL_MS);
	}
}

export async function worktreeUploads(
	worktree: string,
	paths: readonly string[],
): Promise<readonly string[]> {
	const root = await realpath(worktree);
	return Promise.all(
		paths.map(async (path) => {
			const file = await realpath(resolve(root, path)).catch(() => null);
			const info = file === null ? null : await stat(file).catch(() => null);
			if (file === null || !info?.isFile() || !isInsideDirectory(root, file)) {
				throw new Error(
					`${path} is not a file in this worktree. Copy it into the worktree first, for example under .context/, then pass that path.`,
				);
			}
			return file;
		}),
	);
}

export async function hoverTarget(contents: PageContents, target: string): Promise<void> {
	await mouse(contents, 'mouseMoved', await locate(contents, target, 'hover'), {
		button: 'none',
		buttons: 0,
	});
	await settleAfterAction(contents);
}

export async function typeInto(
	contents: PageContents,
	target: string,
	text: string,
	submit: boolean,
): Promise<void> {
	const found = await locate(contents, target, 'see');
	const answer = await runInFrame(contents, found.frame, TYPE_PROGRAM, [
		found.target,
		text,
		submit,
	]);
	const problem = stringField(answer, 'problem');
	if (problem !== undefined) throw new Error(typeError(target, text, problem, answer));
	await settleAfterAction(contents);
}

export async function pressKey(contents: PageContents, chord: string): Promise<void> {
	const events = keyPresses(chord, MAC);
	const { chooser } = await catchingChooser(contents, true, async () => {
		for (const event of events) await devtools(contents, 'Input.dispatchKeyEvent', event);
		await settleAfterAction(contents);
	});
	if (chooser !== null) {
		throw new Error(
			`${chord} opened a file chooser, and Malini closed it. Pick the files with browser_upload on the file field or the button that opens one.`,
		);
	}
}

export async function scrollPage(
	contents: PageContents,
	by: { readonly x: number; readonly y: number; readonly selector?: string },
): Promise<BrowserScrollPosition> {
	const top = await topFrame(contents);
	const point =
		by.selector === undefined
			? centered(top, await runInFrame(contents, top, SCROLL_POSITION_PROGRAM, [null, null]))
			: await locate(contents, by.selector, 'see');
	const read = async (): Promise<BrowserScrollPosition> =>
		scrollPosition(
			await runInFrame(contents, point.frame, SCROLL_POSITION_PROGRAM, [
				point.inner.x,
				point.inner.y,
			]),
		);
	if (by.x === 0 && by.y === 0) return read();
	await mouse(contents, 'mouseWheel', point, { deltaX: by.x, deltaY: by.y });
	const deadline = Date.now() + SCROLL_SETTLE_MS;
	let last = await read();
	for (;;) {
		await delay(SCROLL_POLL_MS);
		const next = await read();
		if ((next.x === last.x && next.y === last.y) || Date.now() >= deadline) return next;
		last = next;
	}
}

export async function untilSized(contents: PageContents, size: BrowserSize): Promise<BrowserSize> {
	const deadline = Date.now() + RESIZE_SETTLE_MS;
	const top = await topFrame(contents);
	for (;;) {
		const answer = await runInFrame(contents, top, VIEWPORT_PROGRAM, []);
		const now = { width: requireNumber(answer, 'width'), height: requireNumber(answer, 'height') };
		if ((now.width === size.width && now.height === size.height) || Date.now() >= deadline) {
			return now;
		}
		await delay(LOAD_POLL_MS);
	}
}

export async function waitFor(contents: PageContents, until: BrowserWait): Promise<void> {
	const { seconds, gone, text, selector } = until;
	const ms = seconds * 1_000;
	if (text === undefined && selector === undefined) return delay(ms);
	const deadline = Date.now() + ms;
	const target =
		selector === undefined ? null : await frameOf(contents, selector).catch(() => null);
	for (;;) {
		const left = Math.max(deadline - Date.now(), LOCATE_POLL_MS);
		const shows =
			selector === undefined
				? await shownAnywhere(contents, text ?? '', left)
				: target === null
					? 'stale'
					: await runInFrame(
							contents,
							target.frame,
							PRESENCE_PROGRAM,
							[target.local, text ?? null],
							left,
						).catch(() => null);
		if (shows === 'stale' && gone) return;
		if (shows === 'invalid' || shows === 'stale') {
			throw new Error(locateError(selector ?? '', shows, null));
		}
		if (typeof shows === 'boolean' && shows !== gone) return;
		if (Date.now() >= deadline) throw new Error(waitError(until));
		await delay(WAIT_POLL_MS);
	}
}

export async function evaluateScript(contents: PageContents, script: string): Promise<string> {
	try {
		let evaluated = await evaluateInPage(contents, script);
		if (returnsAtTopLevel(evaluated)) {
			evaluated = await evaluateInPage(contents, `(async () => {\n${script}\n})()`);
		}
		throwIfThrew(evaluated);
		return clipResult(await serialized(contents, field(evaluated, 'result')));
	} finally {
		if (contents.debugger.isAttached()) {
			void contents.debugger
				.sendCommand('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP })
				.catch(() => undefined);
		}
	}
}

export async function captureFrame(contents: PageContents): Promise<PageImage | null> {
	const deadline = Date.now() + FIRST_FRAME_MS;
	while (Date.now() < deadline) {
		const image = await within(
			contents.capturePage(undefined, { stayHidden: false }),
			deadline - Date.now(),
		).catch(() => undefined);
		if (image && !image.isEmpty()) return image;
		await delay(FRAME_POLL_MS);
	}
	return null;
}

async function writeUnique(directory: string, base: string, png: Buffer): Promise<string> {
	for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
		const name = attempt === 1 ? base : `${base}-${attempt}`;
		try {
			await writeFile(join(directory, `${name}.png`), png, { flag: 'wx' });
			return name;
		} catch (error) {
			if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
		}
	}
	throw new Error(`Too many screenshots named ${base} in ${directory}.`);
}

function fitLongEdge(image: PageImage, longEdge: number): PageImage {
	const { width, height } = image.getSize();
	if (Math.max(width, height) <= longEdge) return image;
	return width >= height
		? image.resize({ width: longEdge, quality: 'good' })
		: image.resize({ height: longEdge, quality: 'good' });
}

function timestamp(now: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function settled(contents: PageContents, deadline: number): Promise<void> {
	while (contents.isLoading() && Date.now() < deadline) await delay(LOAD_POLL_MS);
}

async function locate(contents: PageContents, target: string, mode: LocateMode): Promise<Located> {
	const { frame, local } = await frameOf(contents, target);
	const deadline = Date.now() + ACTION_WAIT_MS;
	let last: Located | null = null;
	for (;;) {
		const answer = await locateIn(contents, frame, local, mode);
		const problem = stringField(answer, 'problem');
		if (problem === undefined) {
			const found = located(answer, frame, local);
			if ((last && samePlace(found, last)) || Date.now() >= deadline) return found;
			last = found;
		} else {
			if (FINAL_PROBLEMS.has(problem) || Date.now() >= deadline) {
				throw new Error(locateError(target, problem, answer));
			}
			last = null;
		}
		await delay(LOCATE_POLL_MS);
	}
}

async function locateIn(
	contents: PageContents,
	frame: PageFrame,
	target: string,
	mode: LocateMode,
): Promise<unknown> {
	const nested = frame.parent !== null;
	const answer = await runInFrame(contents, frame, LOCATE_PROGRAM, [target, mode, nested]);
	if (stringField(answer, 'problem') !== undefined) return answer;
	const inner = { x: requireNumber(answer, 'x'), y: requireNumber(answer, 'y') };
	let { x, y } = inner;
	let rect = rectangle(field(answer, 'rect'));
	for (let child = frame; child.parent !== null; child = child.parent) {
		const check = mode !== 'see';
		const owner = await runInFrame(contents, child.parent, OWNER_PROGRAM, [
			child.index,
			x,
			y,
			check,
		]);
		if (stringField(owner, 'problem') !== undefined) return owner;
		const dx = requireNumber(owner, 'dx');
		const dy = requireNumber(owner, 'dy');
		x += dx;
		y += dy;
		rect = { ...rect, x: rect.x + dx, y: rect.y + dy };
	}
	return { x, y, rect, inner };
}

function located(answer: unknown, frame: PageFrame, target: string): Located {
	const inner = field(answer, 'inner');
	return {
		x: requireNumber(answer, 'x'),
		y: requireNumber(answer, 'y'),
		rect: rectangle(field(answer, 'rect')),
		frame,
		target,
		inner: { x: requireNumber(inner, 'x'), y: requireNumber(inner, 'y') },
	};
}

function rectangle(value: unknown): Rectangle {
	return {
		x: requireNumber(value, 'x'),
		y: requireNumber(value, 'y'),
		width: requireNumber(value, 'width'),
		height: requireNumber(value, 'height'),
	};
}

function samePlace(a: Located, b: Located): boolean {
	return (
		Math.abs(a.x - b.x) < 1 &&
		Math.abs(a.y - b.y) < 1 &&
		Math.abs(a.rect.width - b.rect.width) < 1 &&
		Math.abs(a.rect.height - b.rect.height) < 1
	);
}

function locateError(target: string, problem: string, answer: unknown): string {
	const waited = ACTION_WAIT_MS / 1_000;
	switch (problem) {
		case 'invalid':
			return `\`${target}\` is not a valid CSS selector or ref. Call browser_snapshot to get a ref such as @e3 for any element on the page.`;
		case 'stale':
			return `\`${target}\` is a ref from an older snapshot, and its element is gone. Call browser_snapshot for new refs.`;
		case 'hidden':
			return `\`${target}\` is on the page but did not show within ${waited}s: it has no size or is hidden.`;
		case 'covered':
			return `${stringField(answer, 'by') ?? 'Another element'} covers \`${target}\`, so the mouse reaches it instead. Close or move it first, or wait until it is gone.`;
		case 'popup':
			return popupError(target, stringField(answer, 'kind') ?? '');
		default:
			return `Nothing on the page matches \`${target}\` within ${waited}s. Call browser_snapshot to see what the page shows.`;
	}
}

function popupError(target: string, kind: string): string {
	if (kind === 'select') {
		return `\`${target}\` is a select, and a click opens its menu outside the page. Pick an option with browser_type and the option's label instead.`;
	}
	if (kind === 'file') {
		return `\`${target}\` is a file field, and a click opens a file chooser outside the page. Pick its files with browser_upload instead.`;
	}
	return `\`${target}\` is a ${kind} field, and a click opens a picker outside the page. Set its value with browser_type instead, for example ${FORMATS[kind] ?? 'its value'}.`;
}

function typeError(target: string, text: string, problem: string, answer: unknown): string {
	if (problem === 'readonly') return `\`${target}\` is not a field you can type into.`;
	if (problem === 'option') {
		const options = field(answer, 'options');
		const labels = Array.isArray(options)
			? options.filter((option) => typeof option === 'string')
			: [];
		return `\`${target}\` has no option "${text}". Its options are: ${labels.map((label) => `"${label}"`).join(', ')}.`;
	}
	if (problem === 'format') {
		const kind = stringField(answer, 'kind') ?? '';
		return `\`${target}\` is a ${kind} field and did not take "${text}". Use its format, for example ${FORMATS[kind] ?? 'its value'}.`;
	}
	return locateError(target, problem, answer);
}

function waitError({ seconds, gone, text, selector }: BrowserWait): string {
	const what =
		text === undefined
			? `\`${selector ?? ''}\``
			: selector === undefined
				? `"${text}"`
				: `"${text}" in \`${selector}\``;
	return gone
		? `${what} is still on the page after ${seconds}s.`
		: `${what} did not show within ${seconds}s. Call browser_snapshot to see what the page shows.`;
}

function centered(frame: PageFrame, answer: unknown): Point & Pick<Located, 'frame' | 'inner'> {
	const viewport = field(answer, 'viewport');
	const middle = {
		x: requireNumber(viewport, 'width') / 2,
		y: requireNumber(viewport, 'height') / 2,
	};
	return { ...middle, frame, inner: middle };
}

function scrollPosition(answer: unknown): BrowserScrollPosition {
	const position = {
		x: requireNumber(answer, 'x'),
		y: requireNumber(answer, 'y'),
		height: requireNumber(answer, 'height'),
	};
	const container = stringField(answer, 'container');
	return container === undefined ? position : { ...position, container };
}

function evaluateInPage(contents: PageContents, expression: string): Promise<unknown> {
	return devtools(
		contents,
		'Runtime.evaluate',
		{
			expression,
			objectGroup: OBJECT_GROUP,
			replMode: true,
			awaitPromise: true,
			userGesture: true,
		},
		undefined,
		EVALUATE_TIMEOUT_MS,
	);
}

function returnsAtTopLevel(evaluated: unknown): boolean {
	const exception = field(field(evaluated, 'exceptionDetails'), 'exception');
	return (
		stringField(exception, 'className') === 'SyntaxError' &&
		(stringField(exception, 'description') ?? '').includes('Illegal return statement')
	);
}

function throwIfThrew(answer: unknown): void {
	const details = field(answer, 'exceptionDetails');
	if (details === undefined) return;
	const description =
		stringField(field(details, 'exception'), 'description') ??
		stringField(details, 'text') ??
		'an error';
	throw new Error(`The script threw ${description}`);
}

async function serialized(contents: PageContents, remote: unknown): Promise<string> {
	const objectId = stringField(remote, 'objectId');
	if (objectId === undefined) {
		const value = field(remote, 'value');
		if (typeof value === 'string') return value;
		return (
			stringField(remote, 'unserializableValue') ??
			(stringField(remote, 'type') === 'undefined' ? 'undefined' : JSON.stringify(value))
		);
	}
	const call = await devtools(
		contents,
		'Runtime.callFunctionOn',
		{
			objectId,
			functionDeclaration: SERIALIZE_FUNCTION,
			objectGroup: OBJECT_GROUP,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		},
		undefined,
		EVALUATE_TIMEOUT_MS,
	);
	throwIfThrew(call);
	return stringField(field(call, 'result'), 'value') ?? 'undefined';
}

export function clipResult(text: string): string {
	if (text.length <= MAX_RESULT_CHARS) return text;
	return `${text.slice(0, MAX_RESULT_CHARS)}\n… ${text.length - MAX_RESULT_CHARS} more characters. Return less, for example with .slice().`;
}

async function runInFrame(
	contents: PageContents,
	frame: PageFrame,
	program: string,
	args: readonly unknown[],
	ms = PAGE_ANSWER_MS,
): Promise<unknown> {
	const call = args.map((arg) => JSON.stringify(arg)).join(', ');
	const answer = await evaluateInFrame(contents, frame, `(${program})(${call})`, true, ms);
	return field(field(answer, 'result'), 'value');
}

async function evaluateInFrame(
	contents: PageContents,
	frame: PageFrame,
	expression: string,
	byValue: boolean,
	ms = PAGE_ANSWER_MS,
): Promise<unknown> {
	const { frameId, session } = frame;
	const world = await devtools(
		contents,
		'Page.createIsolatedWorld',
		{ frameId, worldName: WORLD_NAME },
		session,
		ms,
	);
	const answer = await devtools(
		contents,
		'Runtime.evaluate',
		{
			expression,
			contextId: requireNumber(world, 'executionContextId'),
			returnByValue: byValue,
			awaitPromise: true,
			userGesture: true,
		},
		session,
		ms,
	);
	throwIfThrew(answer);
	return answer;
}

async function topFrame(contents: PageContents): Promise<PageFrame> {
	const tree = await devtools(contents, 'Page.getFrameTree');
	const frameId = stringField(field(field(tree, 'frameTree'), 'frame'), 'id');
	if (frameId === undefined) throw new Error('The browser answered without its page frame.');
	return { frameId, session: undefined, parent: null, index: -1 };
}

async function frameOf(
	contents: PageContents,
	target: string,
): Promise<{ readonly frame: PageFrame; readonly local: string }> {
	const ref = FRAME_REF.exec(target);
	if (!ref) return { frame: await topFrame(contents), local: target };
	const frame = framesOf(contents).numbered.get(Number(ref[1]));
	if (!frame) throw new Error(locateError(target, 'stale', null));
	return { frame, local: `@${ref[2] ?? ''}` };
}

async function childFrame(
	contents: PageContents,
	parent: PageFrame,
	index: number,
): Promise<PageFrame | null> {
	const expression = `globalThis.__maliniFrames?.[${index}] ?? null`;
	const owner = await evaluateInFrame(contents, parent, expression, false);
	const objectId = stringField(field(owner, 'result'), 'objectId');
	if (objectId === undefined) return null;
	try {
		const node = await devtools(contents, 'DOM.describeNode', { objectId }, parent.session);
		const frameId = stringField(field(node, 'node'), 'frameId');
		if (frameId === undefined) return null;
		const session = framesOf(contents).sessions.get(frameId) ?? parent.session;
		return { frameId, session, parent, index };
	} finally {
		void devtools(contents, 'Runtime.releaseObject', { objectId }, parent.session).catch(
			() => undefined,
		);
	}
}

async function shownAnywhere(contents: PageContents, text: string, ms: number): Promise<boolean> {
	for (const frame of await everyFrame(contents)) {
		const shows = await runInFrame(contents, frame, PRESENCE_PROGRAM, [null, text], ms).catch(
			() => false,
		);
		if (shows === true) return true;
	}
	return false;
}

async function everyFrame(contents: PageContents): Promise<readonly PageFrame[]> {
	const top = await topFrame(contents);
	const { sessions } = framesOf(contents);
	const found = new Map<string, PageFrame>([[top.frameId, top]]);
	for (const session of [undefined, ...sessions.values()]) {
		const tree = await devtools(contents, 'Page.getFrameTree', {}, session).catch(() => null);
		const visit = (node: unknown): void => {
			const frameId = stringField(field(node, 'frame'), 'id');
			if (frameId !== undefined && !found.has(frameId)) {
				found.set(frameId, {
					frameId,
					session: sessions.get(frameId) ?? session,
					parent: null,
					index: -1,
				});
			}
			for (const child of list(field(node, 'childFrames'))) visit(child);
		};
		visit(field(tree, 'frameTree'));
	}
	return [...found.values()];
}

async function catchingChooser(
	contents: PageContents,
	cancel: boolean,
	action: () => Promise<void>,
): Promise<{ readonly chooser: Chooser | null }> {
	const known = framesOf(contents);
	const caught: Chooser[] = [];
	const catcher = (chooser: Chooser): void => void caught.push(chooser);
	known.choosers.add(catcher);
	const sessions: Array<string | undefined> = [];
	try {
		await devtools(contents, 'Page.enable');
		sessions.push(undefined, ...known.sessions.values());
		for (const session of sessions) {
			if (session !== undefined) await devtools(contents, 'Page.enable', undefined, session);
			const intercept = { enabled: true, cancel };
			await devtools(contents, 'Page.setInterceptFileChooserDialog', intercept, session);
		}
		await action();
		return { chooser: caught[0] ?? null };
	} finally {
		known.choosers.delete(catcher);
		for (const session of sessions) {
			const off = { enabled: false };
			await devtools(contents, 'Page.setInterceptFileChooserDialog', off, session).catch(
				() => undefined,
			);
			await devtools(contents, 'Page.disable', undefined, session).catch(() => undefined);
		}
	}
}

function framesOf(contents: PageContents): Frames {
	const known = pageFrames.get(contents);
	if (known) return known;
	const frames: Frames = { sessions: new Map(), numbered: new Map(), choosers: new Set() };
	pageFrames.set(contents, frames);
	contents.debugger.on('message', (_event, method, params, session) => {
		if (method === 'Target.attachedToTarget') {
			const info = field(params, 'targetInfo');
			const child = stringField(params, 'sessionId');
			const frameId = stringField(info, 'targetId');
			if (stringField(info, 'type') !== 'iframe' || !child || !frameId) return;
			frames.sessions.set(frameId, child);
			const send = (command: string, args: object): Promise<unknown> =>
				contents.debugger.sendCommand(command, args, child).catch(() => undefined);
			void send('Target.setAutoAttach', AUTO_ATTACH);
			void send('Emulation.setFocusEmulationEnabled', { enabled: true });
		} else if (method === 'Target.detachedFromTarget') {
			const gone = stringField(params, 'sessionId');
			for (const [frameId, each] of frames.sessions) {
				if (each === gone) frames.sessions.delete(frameId);
			}
		} else if (method === 'Page.fileChooserOpened') {
			const backendNodeId = field(params, 'backendNodeId');
			if (typeof backendNodeId !== 'number') return;
			const multiple = stringField(params, 'mode') === 'selectMultiple';
			const chooser = { backendNodeId, multiple, session: session || undefined };
			for (const catcher of frames.choosers) catcher(chooser);
		}
	});
	return frames;
}

async function devtools(
	contents: PageContents,
	method: string,
	params?: object,
	session?: string,
	ms = PAGE_ANSWER_MS,
): Promise<unknown> {
	const known = framesOf(contents);
	const target = contents.debugger;
	if (!target.isAttached()) {
		target.attach(DEVTOOLS_PROTOCOL);
		known.sessions.clear();
		await target.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
		await target.sendCommand('Target.setAutoAttach', AUTO_ATTACH);
	}
	const answer = await within(target.sendCommand(method, params, session), ms);
	if (answer === undefined) throw new Error(noAnswer(ms));
	return answer;
}

async function pressAt(contents: PageContents, point: Point): Promise<void> {
	await mouse(contents, 'mouseMoved', point, { button: 'none', buttons: 0 });
	await mouse(contents, 'mousePressed', point, { button: 'left', buttons: 1, clickCount: 1 });
	await mouse(contents, 'mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 });
}

function list(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

function mouse(
	contents: PageContents,
	type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel',
	{ x, y }: Point,
	details: object,
): Promise<unknown> {
	return devtools(contents, 'Input.dispatchMouseEvent', { type, x, y, ...details });
}

function noAnswer(ms: number): string {
	return `The page did not answer within ${ms / 1_000}s. It may wait on a dialog or a busy script. Call browser_screenshot to see what it shows.`;
}

function snapOut({ x, y, width, height }: Rectangle): Rectangle {
	const left = Math.floor(x);
	const top = Math.floor(y);
	return {
		x: left,
		y: top,
		width: Math.ceil(x + width) - left,
		height: Math.ceil(y + height) - top,
	};
}

function inside(inner: Rectangle, outer: Rectangle): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
	const found = field(value, key);
	return typeof found === 'string' ? found : undefined;
}

function requireNumber(value: unknown, key: string): number {
	const found = field(value, key);
	if (typeof found !== 'number' || !Number.isFinite(found)) {
		throw new Error(`The browser answered without a number for \`${key}\`.`);
	}
	return found;
}

export async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
	void work.catch(() => undefined);
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadErrorCode(error: unknown): string | null {
	const code: unknown =
		typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null;
	return typeof code === 'string' ? code : null;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
