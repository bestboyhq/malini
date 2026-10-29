import { LEAD_PROMPT, OWNER } from './demo-data';
import { leadReport } from './demo-live';

const MOVE_MS = 700;
const DRAG_MS = 3_600;

class Stopped extends Error {}

function showCursor(): HTMLElement | null {
	const cursor = document.querySelector<HTMLElement>('.demo-cursor');
	if (!cursor) return null;
	cursor.style.translate = `${innerWidth * 0.62}px ${innerHeight * 0.7}px`;
	cursor.hidden = false;
	return cursor;
}

export async function playHero(): Promise<void> {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const cursor = showCursor();
	if (!cursor) return;
	let stopped = false;
	const stop = (event: Event): void => {
		if (!event.isTrusted) return;
		stopped = true;
		cursor.hidden = true;
	};
	addEventListener('pointerdown', stop, { capture: true });
	addEventListener('keydown', stop, { capture: true });

	const wait = async (ms: number): Promise<void> => {
		await new Promise((resolve) => setTimeout(resolve, ms));
		if (stopped) throw new Stopped();
	};
	const find = async (selector: string): Promise<HTMLElement> => {
		for (;;) {
			const element = document.querySelector(selector);
			if (element instanceof HTMLElement && element.getClientRects().length > 0) return element;
			await wait(100);
		}
	};
	const moveTo = async (element: HTMLElement, dx = 0.5): Promise<void> => {
		const box = element.getBoundingClientRect();
		cursor.style.translate = `${box.left + box.width * dx}px ${box.top + box.height / 2}px`;
		await wait(MOVE_MS + 80);
	};
	const click = async (element: HTMLElement): Promise<void> => {
		await moveTo(element);
		cursor.dataset['pressed'] = '';
		await wait(140);
		delete cursor.dataset['pressed'];
		element.click();
	};

	const drag = async (wipe: HTMLElement): Promise<void> => {
		if (!(wipe instanceof HTMLInputElement)) return;
		await moveTo(wipe);
		cursor.style.transition = 'none';
		const box = wipe.getBoundingClientRect();
		const started = performance.now();
		for (let t = 0; t < DRAG_MS; t = performance.now() - started) {
			const value = 50 + 38 * Math.sin((2 * Math.PI * t) / DRAG_MS);
			wipe.value = String(value);
			wipe.dispatchEvent(new Event('input', { bubbles: true }));
			cursor.style.translate = `${box.left + (box.width * value) / 100}px ${box.top + box.height / 2}px`;
			await wait(16);
		}
		cursor.style.transition = '';
	};

	try {
		await wait(1800);
		const newChat = await find(`[aria-label="New chat in ${OWNER}"]`);
		await moveTo(newChat, 0.5);
		newChat.focus({ focusVisible: true });
		await wait(350);
		await click(newChat);
		const editor = await find('[data-testid="chat-composer-input"]');
		await moveTo(editor, 0.15);
		editor.focus();
		await wait(300);
		for (const character of LEAD_PROMPT) {
			document.execCommand('insertText', false, character);
			await wait(22 + Math.random() * 38);
		}
		await wait(500);
		await click(await find('[data-testid="chat-composer-submit"]:not([disabled])'));
		await wait(900);
		await moveTo(await find('[data-testid="sidebar-chat"]'), 0.9);
		await leadReport;
		await wait(4200);
		await click(await find('[data-workstream-id="ws-tony-og"]'));
		await wait(1600);
		await drag(await find('input[aria-label="Wipe between before and after"]'));
		await wait(600);
		cursor.dataset['gone'] = '';
	} catch (error) {
		if (!(error instanceof Stopped)) throw error;
	}
}
