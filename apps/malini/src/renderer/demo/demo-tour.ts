import { pagePart } from './demo-browser';
import { drawnCursor, inView, Stopped, type Cursor } from './demo-cursor';
import { TOUR_FEEDBACK, TOUR_PROMPT, TOUR_TONY_ID } from './demo-tour-data';

export type CameraShot = Readonly<{ x: number; y: number; width: number; height: number }>;

export const CAMERA_MESSAGE = 'malini-demo:camera';
export const READY_MESSAGE = 'malini-demo:ready';
export const PLAY_MESSAGE = 'malini-demo:play';

let aimed: CameraShot | null = null;

function aim(shot: CameraShot | null): void {
	aimed = shot;
	if (parent === window) return;
	parent.postMessage({ type: CAMERA_MESSAGE, shot }, location.origin);
}

function around(elements: readonly Element[], pad: number): CameraShot {
	const boxes = elements.map((element) => element.getBoundingClientRect());
	const left = Math.max(0, Math.min(...boxes.map((box) => box.left)) - pad);
	const top = Math.max(0, Math.min(...boxes.map((box) => box.top)) - pad);
	const right = Math.min(innerWidth, Math.max(...boxes.map((box) => box.right)) + pad);
	const bottom = Math.min(innerHeight, Math.max(...boxes.map((box) => box.bottom)) + pad);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function cue(): Promise<void> {
	if (parent === window) return inView();
	return new Promise((resolve) => {
		const ask = (): void => {
			aim(aimed);
			parent.postMessage({ type: READY_MESSAGE }, location.origin);
		};
		const asking = setInterval(ask, 500);
		const play = (event: MessageEvent): void => {
			if (event.source !== parent || event.data?.type !== PLAY_MESSAGE) return;
			clearInterval(asking);
			removeEventListener('message', play);
			resolve();
		};
		addEventListener('message', play);
		ask();
	});
}

const page = (): ParentNode | null => pagePart('.frame')?.parentNode ?? null;

async function typeInto(cursor: Cursor, text: string, put: (typed: string) => void): Promise<void> {
	for (const word of text.split(/(?<=\s)/u)) {
		put(word);
		await cursor.wait(45 + Math.random() * 70);
	}
}

async function hoverOn(cursor: Cursor, element: HTMLElement, dx = 0.5): Promise<void> {
	await cursor.moveTo(element, dx);
	element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
}

export async function playTour(): Promise<void> {
	const cursor = drawnCursor({ x: innerWidth * 0.5, y: innerHeight * 0.6 });
	if (!cursor) return;
	const { click, find, wait } = cursor;
	try {
		const newChat = await find('[data-testid="sidebar-new-chat-row"]');
		const side = newChat.getBoundingClientRect();
		const sidebar: CameraShot = { x: 0, y: 0, width: side.right + 16, height: innerHeight };
		aim({ x: 0, y: 0, width: side.right + 40, height: (side.right + 40) * 0.78 });
		await cue();
		await wait(700);
		await click(newChat, 0.3);

		const editor = await find('[data-testid="chat-composer-input"]');
		aim({ x: 0, y: 0, width: editor.getBoundingClientRect().right + 24, height: innerHeight });
		await wait(500);
		editor.focus({ preventScroll: true });
		await typeInto(cursor, TOUR_PROMPT, (word) => document.execCommand('insertText', false, word));
		await click(await find('[data-testid="chat-composer-submit"]:not([disabled])'));

		await wait(1_600);
		aim({ ...sidebar, height: innerHeight * 0.72 });
		const tony = await find(`[data-workstream-id="${TOUR_TONY_ID}"]`);
		await wait(1_500);
		await click(tony, 0.4);

		aim(null);
		const frame = await find('.frame', page);
		const toolbar = await find('button[aria-label="Pick an element"]:not([disabled])');
		await wait(900);
		aim(around([toolbar, frame], 20));
		await wait(900);
		await click(toolbar);

		await hoverOn(cursor, await find('h1', page));
		await wait(500);
		await hoverOn(cursor, await find('img', page), 0.6);
		await wait(450);
		const link = await find('a.changelog', page);
		await hoverOn(cursor, link);
		const footer = await find('footer', page);
		aim(around([footer, link], 40));
		await wait(700);
		await cursor.press();
		link.click();

		const panel = await find('.panel', page);
		aim(around([footer, panel], 28));
		const field = await find('.panel textarea', page);
		await cursor.moveTo(field, 0.3);
		await wait(250);
		if (field instanceof HTMLTextAreaElement) {
			await typeInto(cursor, TOUR_FEEDBACK, (word) => {
				field.value += word;
				field.dispatchEvent(new Event('input', { bubbles: true }));
			});
		}
		await wait(400);
		await click(await find('.panel .send:not([disabled])', page));

		const pin = await find('.pin.done', page);
		aim(around([footer, pin], 60));
		await wait(700);
		await click(pin);
		await wait(900);
		await click(await find('.card .open', page));

		await find('[data-testid="chat-agent-tab"][data-session-id^="thread-"]');
		await wait(600);
		aim(around([await find('[data-testid="chat-composer-input"]'), frame], 16));
		await wait(2_600);
		cursor.element.dataset['gone'] = '';
		aim(null);
	} catch (error) {
		aim(null);
		if (!(error instanceof Stopped)) throw error;
	}
}
