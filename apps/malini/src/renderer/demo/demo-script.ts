import { LEAD_PROMPT, OWNER } from './demo-data';
import { leadReport } from './demo-live';

const DRAG_MS = 4_200;

class Stopped extends Error {}

type Point = Readonly<{ x: number; y: number }>;

const smooth = (t: number): number => t * t * t * (10 + t * (6 * t - 15));

function typingPause(character: string, next: string | undefined): number {
	if (character === '.' || character === ',') return 260 + Math.random() * 220;
	if (character === ' ' && next !== undefined && /[A-Z]/u.test(next))
		return 140 + Math.random() * 120;
	if (character === ' ') return 55 + Math.random() * 70;
	return 32 + Math.random() * 48;
}

function showCursor(): HTMLElement | null {
	const cursor = document.querySelector<HTMLElement>('.demo-cursor');
	if (!cursor) return null;
	cursor.hidden = false;
	return cursor;
}

export async function playHero(): Promise<void> {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const cursor = showCursor();
	if (!cursor) return;
	let stopped = false;
	let at: Point = { x: innerWidth * 0.62, y: innerHeight * 0.74 };
	const place = (point: Point): void => {
		at = point;
		cursor.style.translate = `${point.x}px ${point.y}px`;
	};
	place(at);
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
	const frame = async (): Promise<number> => {
		const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
		if (stopped) throw new Stopped();
		return now;
	};
	const find = async (selector: string): Promise<HTMLElement> => {
		for (;;) {
			const element = document.querySelector(selector);
			if (element instanceof HTMLElement && element.getClientRects().length > 0) return element;
			await wait(100);
		}
	};
	const glide = async (to: Point): Promise<void> => {
		const from = at;
		const distance = Math.hypot(to.x - from.x, to.y - from.y);
		const duration = Math.min(1_250, 420 + distance * 0.75);
		const bend = Math.min(60, distance * 0.12) / (distance || 1);
		const control = {
			x: (from.x + to.x) / 2 - (to.y - from.y) * bend,
			y: (from.y + to.y) / 2 + (to.x - from.x) * bend,
		};
		const started = await frame();
		for (let now = started; now - started < duration; now = await frame()) {
			const t = smooth((now - started) / duration);
			const u = 1 - t;
			place({
				x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
				y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
			});
		}
		place(to);
	};
	const moveTo = async (element: HTMLElement, dx = 0.5): Promise<void> => {
		const box = element.getBoundingClientRect();
		await glide({ x: box.left + box.width * dx, y: box.top + box.height / 2 });
		await wait(120 + Math.random() * 120);
	};
	const click = async (element: HTMLElement, dx = 0.5): Promise<void> => {
		await moveTo(element, dx);
		cursor.dataset['pressed'] = '';
		await wait(130);
		delete cursor.dataset['pressed'];
		element.click();
	};
	const drag = async (wipe: HTMLElement): Promise<void> => {
		if (!(wipe instanceof HTMLInputElement)) return;
		const box = wipe.getBoundingClientRect();
		await glide({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
		await wait(250);
		cursor.dataset['pressed'] = '';
		const started = await frame();
		for (let now = started; now - started < DRAG_MS; now = await frame()) {
			const value = 50 + 36 * Math.sin((2 * Math.PI * (now - started)) / DRAG_MS);
			wipe.value = String(value);
			wipe.dispatchEvent(new Event('input', { bubbles: true }));
			place({ x: box.left + (box.width * value) / 100, y: box.top + box.height / 2 });
		}
		delete cursor.dataset['pressed'];
	};

	try {
		await wait(2_000);
		const owner = await find(`[aria-label="New chat in ${OWNER}"]`);
		await moveTo(owner, -6);
		await wait(500);
		owner.focus({ focusVisible: true });
		await wait(450);
		await click(owner);
		const editor = await find('[data-testid="chat-composer-input"]');
		await wait(600);
		await moveTo(editor, 0.2);
		editor.focus();
		await wait(500);
		const characters = [...LEAD_PROMPT];
		for (const [index, character] of characters.entries()) {
			document.execCommand('insertText', false, character);
			await wait(typingPause(character, characters[index + 1]));
		}
		await wait(800);
		await click(await find('[data-testid="chat-composer-submit"]:not([disabled])'));
		await wait(1_600);
		await moveTo(await find('[data-testid="sidebar-chat"]'), 0.55);
		await find('[data-testid="started-workstreams"]');
		await wait(2_400);
		await moveTo(await find('[data-testid="started-workstreams"]'), 0.7);
		await leadReport;
		await wait(2_200);
		for (const index of [1, 2]) {
			const tab = document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')[index];
			if (!tab) break;
			await click(tab);
			await wait(2_400);
		}
		await wait(800);
		await click(await find('[data-workstream-id="ws-tony-hero"]'), 0.4);
		await wait(2_200);
		await drag(await find('input[aria-label="Wipe between before and after"]'));
		await wait(900);
		cursor.dataset['gone'] = '';
	} catch (error) {
		if (!(error instanceof Stopped)) throw error;
	}
}
