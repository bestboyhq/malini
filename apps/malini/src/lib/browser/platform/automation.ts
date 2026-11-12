import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isErrnoException } from '$main/errors';
import { SANDBOX_SCRATCH_PATH } from '$main/git/paths';
import type {
	BrowserScreenshotFile,
	BrowserScreenshotPart,
	BrowserScrollPosition,
	BrowserSize,
	BrowserWait,
} from '../browser.platform';
import { keyPresses } from './keyboard';
import { MALINI_WORLD_ID, type PageContents, type PageImage, type Rectangle } from './page';
import {
	LOCATE_PROGRAM,
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
const ACTION_SETTLE_MS = 10_000;
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
	readonly page: Rectangle;
}

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
	const clip = snapOut(
		element?.page ?? {
			x: 0,
			y: 0,
			width: requireNumber(content, 'width'),
			height: Math.min(height, FULL_PAGE_MAX_HEIGHT),
		},
	);
	const visible = {
		x: requireNumber(viewport, 'pageX'),
		y: requireNumber(viewport, 'pageY'),
		width: requireNumber(viewport, 'clientWidth'),
		height: requireNumber(viewport, 'clientHeight'),
	};
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
	const text = await runInPage(contents, SNAPSHOT_PROGRAM, [
		SNAPSHOT_MAX_LINES,
		SNAPSHOT_MAX_CHARS,
	]);
	if (typeof text !== 'string') throw new Error('The page did not return a snapshot.');
	return text;
}

export async function clickTarget(contents: PageContents, target: string): Promise<void> {
	const point = await locate(contents, target, 'click');
	await mouse(contents, 'mouseMoved', point, { button: 'none', buttons: 0 });
	await mouse(contents, 'mousePressed', point, { button: 'left', buttons: 1, clickCount: 1 });
	await mouse(contents, 'mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 });
	await settleAfterAction(contents);
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
	await locate(contents, target, 'see');
	const answer = await runInPage(contents, TYPE_PROGRAM, [target, text, submit]);
	const problem = stringField(answer, 'problem');
	if (problem !== undefined) throw new Error(typeError(target, text, problem, answer));
	await settleAfterAction(contents);
}

export async function pressKey(contents: PageContents, chord: string): Promise<void> {
	for (const event of keyPresses(chord, MAC)) {
		await devtools(contents, 'Input.dispatchKeyEvent', event);
	}
	await settleAfterAction(contents);
}

export async function scrollPage(
	contents: PageContents,
	by: { readonly x: number; readonly y: number; readonly selector?: string },
): Promise<BrowserScrollPosition> {
	const point =
		by.selector === undefined
			? middleOf(await runInPage(contents, SCROLL_POSITION_PROGRAM, [null, null]))
			: await locate(contents, by.selector, 'see');
	const read = async (): Promise<BrowserScrollPosition> =>
		scrollPosition(await runInPage(contents, SCROLL_POSITION_PROGRAM, [point.x, point.y]));
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
	for (;;) {
		const answer = await runInPage(contents, VIEWPORT_PROGRAM, []);
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
	for (;;) {
		const left = Math.max(deadline - Date.now(), LOCATE_POLL_MS);
		const shows = await runInPage(
			contents,
			PRESENCE_PROGRAM,
			[selector ?? null, text ?? null],
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
	const deadline = Date.now() + ACTION_WAIT_MS;
	let last: Located | null = null;
	for (;;) {
		const answer = await runInPage(contents, LOCATE_PROGRAM, [target, mode]);
		const problem = stringField(answer, 'problem');
		if (problem === undefined) {
			const found = located(answer);
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

function located(answer: unknown): Located {
	const page = field(answer, 'page');
	return {
		x: requireNumber(answer, 'x'),
		y: requireNumber(answer, 'y'),
		page: {
			x: requireNumber(page, 'x'),
			y: requireNumber(page, 'y'),
			width: requireNumber(page, 'width'),
			height: requireNumber(page, 'height'),
		},
	};
}

function samePlace(a: Located, b: Located): boolean {
	return (
		Math.abs(a.x - b.x) < 1 &&
		Math.abs(a.y - b.y) < 1 &&
		Math.abs(a.page.width - b.page.width) < 1 &&
		Math.abs(a.page.height - b.page.height) < 1
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
		return `\`${target}\` opens a file chooser outside the page, and Malini's browser tools cannot pick files.`;
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

function middleOf(answer: unknown): Point {
	const viewport = field(answer, 'viewport');
	return { x: requireNumber(viewport, 'width') / 2, y: requireNumber(viewport, 'height') / 2 };
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
		EVALUATE_TIMEOUT_MS,
	);
	throwIfThrew(call);
	return stringField(field(call, 'result'), 'value') ?? 'undefined';
}

export function clipResult(text: string): string {
	if (text.length <= MAX_RESULT_CHARS) return text;
	return `${text.slice(0, MAX_RESULT_CHARS)}\n… ${text.length - MAX_RESULT_CHARS} more characters. Return less, for example with .slice().`;
}

async function runInPage(
	contents: PageContents,
	program: string,
	args: readonly unknown[],
	ms = PAGE_ANSWER_MS,
): Promise<unknown> {
	const call = args.map((arg) => JSON.stringify(arg)).join(', ');
	const answer = await within(
		contents.executeJavaScriptInIsolatedWorld(
			MALINI_WORLD_ID,
			[{ code: `(${program})(${call})` }],
			true,
		),
		ms,
	);
	if (answer === undefined) throw new Error(noAnswer(ms));
	return answer;
}

async function devtools(
	contents: PageContents,
	method: string,
	params?: object,
	ms = PAGE_ANSWER_MS,
): Promise<unknown> {
	const session = contents.debugger;
	if (!session.isAttached()) {
		session.attach(DEVTOOLS_PROTOCOL);
		await session.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
	}
	const answer = await within(session.sendCommand(method, params), ms);
	if (answer === undefined) throw new Error(noAnswer(ms));
	return answer;
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
