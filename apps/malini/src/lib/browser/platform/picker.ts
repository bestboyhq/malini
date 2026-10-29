import type { AgentElementRect, AgentElementReference } from '$contract/agent';
import type {
	BrowserElementPrompt,
	BrowserScreenshot,
	BrowserThreadStarted,
} from '$contract/browser';
import { MALINI_WORLD_ID, type PageContents, type PageImage, type Rectangle } from './page';
import { pickerScript, sourceScript, type PickerCommand, type PickerModel } from './picker-page';

export const ELEMENT_PADDING = 8;

const MAX_HTML_CHARS = 2_048;
const MAX_URL_CHARS = 8_192;
const MAX_DOM_PATH_CHARS = 8_192;
const MAX_SOURCE_CHARS = 1_024;
const MAX_PROMPT_CHARS = 20_000;
const MAX_ERROR_CHARS = 300;
const LINE_BREAK = /[\n\r\0]/;

export interface PickerPage {
	run(command: PickerCommand): Promise<unknown>;
	readSource(domPath: string): Promise<unknown>;
	capture(area: Rectangle | undefined): Promise<PageImage>;
	zoomFactor(): number;
}

interface Viewport {
	readonly width: number;
	readonly height: number;
}

interface Selection {
	readonly domPath: string;
	readonly rect: AgentElementRect;
	readonly html: string;
	readonly url: string;
	readonly viewport: Viewport;
}

type Answer =
	| { readonly kind: 'send'; readonly prompt: string; readonly model: string }
	| { readonly kind: 'reselect' };

export interface PickRequest {
	readonly model: string;
	readonly models: readonly PickerModel[];
}

export type StartThread = (picked: BrowserElementPrompt) => Promise<string>;

export function pickerPage(contents: PageContents): PickerPage {
	return {
		run: (command) =>
			contents.executeJavaScriptInIsolatedWorld(
				MALINI_WORLD_ID,
				[{ code: pickerScript(command) }],
				true,
			),
		readSource: (domPath) => contents.executeJavaScript(sourceScript(domPath)),
		capture: (area) => contents.capturePage(area, { stayHidden: true }),
		zoomFactor: () => contents.getZoomFactor(),
	};
}

export async function pickElement(
	page: PickerPage,
	signal: AbortSignal,
	request: PickRequest,
	start: StartThread,
): Promise<BrowserThreadStarted | null> {
	try {
		let reselect = false;
		let model = request.model;
		for (;;) {
			const selection = readSelection(
				await untilAborted(page.run({ kind: 'select', reselect }), signal),
			);
			if (selection === null || signal.aborted) return null;
			const source = readSourceLocation(
				await untilAborted(readSourceQuietly(page, selection.domPath), signal),
			);
			const screenshot = await captureElement(page, selection);
			const element: AgentElementReference = {
				url: selection.url,
				domPath: selection.domPath,
				rect: selection.rect,
				html: selection.html,
				...(source === null ? {} : { source }),
			};
			let error: string | null = null;
			for (;;) {
				const asked = page.run({ kind: 'prompt', models: request.models, model, error });
				const answer = readAnswer(await untilAborted(asked, signal), request);
				if (answer === null || signal.aborted) return null;
				if (answer.kind === 'reselect') break;
				model = answer.model;
				try {
					const sessionId = await start({ prompt: answer.prompt, model, element, screenshot });
					return { sessionId, model };
				} catch (failure) {
					error = failureMessage(failure);
				}
			}
			reselect = true;
		}
	} finally {
		void page.run({ kind: 'end' }).catch(() => undefined);
	}
}

export function cropArea(
	rect: AgentElementRect,
	viewport: Viewport,
	zoom: number,
): Rectangle | undefined {
	const left = clamp(rect.left - ELEMENT_PADDING, 0, viewport.width);
	const top = clamp(rect.top - ELEMENT_PADDING, 0, viewport.height);
	const right = clamp(rect.left + rect.width + ELEMENT_PADDING, 0, viewport.width);
	const bottom = clamp(rect.top + rect.height + ELEMENT_PADDING, 0, viewport.height);
	if (right <= left || bottom <= top) return undefined;
	const x = Math.floor(left * zoom);
	const y = Math.floor(top * zoom);
	return { x, y, width: Math.ceil(right * zoom) - x, height: Math.ceil(bottom * zoom) - y };
}

async function captureElement(page: PickerPage, selection: Selection): Promise<BrowserScreenshot> {
	const image = await page.capture(cropArea(selection.rect, selection.viewport, page.zoomFactor()));
	if (image.isEmpty())
		throw new Error('The browser returned an empty frame for the picked element.');
	return { mediaType: 'image/png', base64: image.toPNG().toString('base64') };
}

async function readSourceQuietly(page: PickerPage, domPath: string): Promise<unknown> {
	try {
		return await page.readSource(domPath);
	} catch {
		return null;
	}
}

export async function untilAborted(work: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
	void work.catch(() => undefined);
	if (signal.aborted) return null;
	const aborted = new Promise<null>((resolve) => {
		signal.addEventListener('abort', () => resolve(null), { once: true });
	});
	return Promise.race([work, aborted]);
}

function readSelection(value: unknown): Selection | null {
	if (value === null || value === undefined) return null;
	const domPath = boundedText(field(value, 'domPath'), MAX_DOM_PATH_CHARS);
	const html = field(value, 'html');
	const url = field(value, 'url');
	const rect = readRect(field(value, 'rect'));
	const viewport = readViewport(field(value, 'viewport'));
	if (
		domPath === null ||
		typeof html !== 'string' ||
		html.length === 0 ||
		typeof url !== 'string' ||
		url.length === 0 ||
		LINE_BREAK.test(url) ||
		rect === null ||
		viewport === null
	) {
		throw new Error('The element picker returned a selection Malini cannot read.');
	}
	return {
		domPath,
		rect,
		html: html.slice(0, MAX_HTML_CHARS),
		url: url.slice(0, MAX_URL_CHARS),
		viewport,
	};
}

function readAnswer(value: unknown, request: PickRequest): Answer | null {
	if (value === null || value === undefined) return null;
	const kind = field(value, 'kind');
	if (kind === 'reselect') return { kind };
	const prompt = field(value, 'prompt');
	const model = request.models.length === 0 ? request.model : field(value, 'model');
	const offered = request.models.length === 0 || request.models.some(({ id }) => id === model);
	if (kind === 'send' && typeof prompt === 'string' && typeof model === 'string' && offered) {
		const trimmed = prompt.trim();
		if (trimmed.length > 0) return { kind, prompt: trimmed.slice(0, MAX_PROMPT_CHARS), model };
	}
	throw new Error('The element picker returned a prompt Malini cannot read.');
}

function failureMessage(failure: unknown): string {
	const message = failure instanceof Error ? failure.message : String(failure);
	return message.trim().slice(0, MAX_ERROR_CHARS) || 'The thread did not start.';
}

function readSourceLocation(value: unknown): string | null {
	return typeof value === 'string' ? boundedText(value.trim(), MAX_SOURCE_CHARS) : null;
}

function readRect(value: unknown): AgentElementRect | null {
	const top = field(value, 'top');
	const left = field(value, 'left');
	const width = field(value, 'width');
	const height = field(value, 'height');
	if (!isFiniteNumber(top) || !isFiniteNumber(left)) return null;
	if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
	return { top, left, width, height };
}

function readViewport(value: unknown): Viewport | null {
	const width = field(value, 'width');
	const height = field(value, 'height');
	if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null;
	return { width, height };
}

function boundedText(value: unknown, max: number): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > max) return null;
	return LINE_BREAK.test(value) ? null : value;
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
