import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isErrnoException } from '$main/errors';
import { SANDBOX_SCRATCH_PATH } from '$main/git/paths';
import type { BrowserScreenshotFile } from '../browser.platform';
import { MALINI_WORLD_ID, type PageContents, type PageImage } from './page';

export const SCREENSHOTS_PATH = `${SANDBOX_SCRATCH_PATH}/screenshots`;
export const PREVIEW_LONG_EDGE = 1_568;

const OPEN_TIMEOUT_MS = 20_000;
const ACTION_SETTLE_MS = 10_000;
const NAVIGATION_GRACE_MS = 250;
const LOAD_POLL_MS = 50;
const MAX_NAME_ATTEMPTS = 1_000;

export async function openUrl(contents: PageContents, url: string): Promise<void> {
	const deadline = Date.now() + OPEN_TIMEOUT_MS;
	try {
		await within(contents.loadURL(url), OPEN_TIMEOUT_MS);
	} catch (error) {
		if (loadErrorCode(error) !== 'ERR_ABORTED') {
			throw new Error(`Could not open ${url}: ${loadErrorCode(error) ?? describe(error)}`);
		}
	}
	await settled(contents, deadline);
}

export async function clickSelector(contents: PageContents, selector: string): Promise<void> {
	await actOnSelector(contents, CLICK_PROGRAM, [selector]);
	await settleAfterAction(contents);
}

export async function typeIntoSelector(
	contents: PageContents,
	selector: string,
	text: string,
	submit: boolean,
): Promise<void> {
	await actOnSelector(contents, TYPE_PROGRAM, [selector, text, submit]);
	await settleAfterAction(contents);
}

export async function settleAfterAction(contents: PageContents): Promise<void> {
	await delay(NAVIGATION_GRACE_MS);
	await settled(contents, Date.now() + ACTION_SETTLE_MS);
}

async function actOnSelector(
	contents: PageContents,
	program: string,
	args: readonly [selector: string, ...rest: unknown[]],
): Promise<void> {
	const call = args.map((arg) => JSON.stringify(arg)).join(', ');
	const outcome = await contents.executeJavaScriptInIsolatedWorld(
		MALINI_WORLD_ID,
		[{ code: `(${program})(${call})` }],
		true,
	);
	const selector = args[0];
	if (outcome === 'done') return;
	if (outcome === 'invalid') throw new Error(`\`${selector}\` is not a valid CSS selector.`);
	if (outcome === 'readonly') throw new Error(`\`${selector}\` is not a field you can type into.`);
	throw new Error(`Nothing on the page matches \`${selector}\`.`);
}

export async function saveScreenshot(
	contents: PageContents,
	worktree: string,
	now: Date,
): Promise<BrowserScreenshotFile> {
	const image = await contents.capturePage(undefined, { stayHidden: true });
	if (image.isEmpty()) {
		throw new Error('The browser returned an empty frame. Open the page again with browser_open.');
	}
	const directory = join(worktree, SCREENSHOTS_PATH);
	await mkdir(directory, { recursive: true });
	const name = await writeUnique(directory, timestamp(now), image.toPNG());
	const previewPath = join(directory, `${name}.jpg`);
	await writeFile(previewPath, fitLongEdge(image, PREVIEW_LONG_EDGE).toJPEG(80));
	return { path: `${SCREENSHOTS_PATH}/${name}.png`, previewPath, url: contents.getURL() };
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

async function within(work: Promise<unknown>, ms: number): Promise<void> {
	void work.catch(() => undefined);
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			work,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export function delay(ms: number): Promise<void> {
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

const CLICK_PROGRAM = String.raw`(selector) => {
	let element;
	try {
		element = document.querySelector(selector);
	} catch {
		return 'invalid';
	}
	if (!element) return 'missing';
	if (typeof element.scrollIntoView === 'function') {
		element.scrollIntoView({ block: 'center', inline: 'center' });
	}
	const rect = element.getBoundingClientRect();
	const point = {
		bubbles: true,
		cancelable: true,
		composed: true,
		view: window,
		button: 0,
		clientX: rect.left + rect.width / 2,
		clientY: rect.top + rect.height / 2,
	};
	const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
	element.dispatchEvent(new PointerEvent('pointerdown', { ...point, ...pointer, buttons: 1 }));
	element.dispatchEvent(new MouseEvent('mousedown', { ...point, buttons: 1, detail: 1 }));
	if (typeof element.focus === 'function') element.focus({ preventScroll: true });
	element.dispatchEvent(new PointerEvent('pointerup', { ...point, ...pointer }));
	element.dispatchEvent(new MouseEvent('mouseup', { ...point, detail: 1 }));
	element.dispatchEvent(new MouseEvent('click', { ...point, detail: 1 }));
	return 'done';
}`;

const TYPE_PROGRAM = String.raw`(selector, text, submit) => {
	let element;
	try {
		element = document.querySelector(selector);
	} catch {
		return 'invalid';
	}
	if (!element) return 'missing';
	const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
	if (!element.isContentEditable && (!field || element.readOnly || element.disabled)) {
		return 'readonly';
	}
	element.scrollIntoView({ block: 'center', inline: 'center' });
	element.focus({ preventScroll: true });
	if (field) element.select();
	else getSelection()?.selectAllChildren(element);
	document.execCommand(text ? 'insertText' : 'delete', false, text);
	if (!submit) return 'done';
	const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
	const proceed = element.dispatchEvent(new KeyboardEvent('keydown', enter));
	element.dispatchEvent(new KeyboardEvent('keypress', enter));
	if (proceed && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
	element.dispatchEvent(new KeyboardEvent('keyup', enter));
	return 'done';
}`;
