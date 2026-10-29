import { LEAD_PROMPT } from './demo-data';
import { WIPE_MS, wipeAt } from './demo-attract';
import { drawnCursor, inView, Stopped } from './demo-cursor';
import { leadReport } from './demo-live';

export async function playHero(): Promise<void> {
	const cursor = drawnCursor({ x: innerWidth * 0.62, y: innerHeight * 0.74 });
	if (!cursor) return;
	const { find, frame, glide, place, wait, click } = cursor;
	const drag = async (wipe: HTMLElement): Promise<void> => {
		if (!(wipe instanceof HTMLInputElement)) return;
		const box = wipe.getBoundingClientRect();
		await glide({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
		await wait(250);
		cursor.element.dataset['pressed'] = '';
		const started = await frame();
		for (let now = started; now - started < WIPE_MS; now = await frame()) {
			const value = wipeAt(now - started);
			wipe.value = String(value);
			wipe.dispatchEvent(new Event('input', { bubbles: true }));
			place({ x: box.left + (box.width * value) / 100, y: box.top + box.height / 2 });
		}
		delete cursor.element.dataset['pressed'];
	};

	try {
		await inView();
		const editor = await find('[data-testid="chat-composer-input"]');
		editor.focus();
		document.execCommand('selectAll');
		document.execCommand('insertText', false, LEAD_PROMPT);
		const send = await find('[data-testid="chat-composer-submit"]:not([disabled])');
		const box = send.getBoundingClientRect();
		place({ x: box.left - 140, y: box.top - 70 });
		await click(send);
		await find('[data-workstream-id="ws-og-tony"]');
		await wait(500);
		await click(await find('[data-workstream-id="ws-tony-hero"]'), 0.4);
		await wait(900);
		await drag(await find('input[aria-label="Wipe between before and after"]'));
		await click(await find('button[aria-label="Merge"]'));
		await wait(800);
		await click(await find('[data-workstream-id="ws-og-lead"]'), 0.4);
		await leadReport;
		await wait(1_100);
		for (const index of [1, 2]) {
			const tab = document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')[index];
			if (!tab) break;
			await click(tab);
			await wait(1_700);
		}
		cursor.element.dataset['gone'] = '';
	} catch (error) {
		if (!(error instanceof Stopped)) throw error;
	}
}
