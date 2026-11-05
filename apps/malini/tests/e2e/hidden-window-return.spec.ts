import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	untilStill,
} from './harness';

type WhileHidden = { bufferedCharacters: number[]; transcriptAnimations: number };

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';

async function hideWindow(page: Page, { midReply }: { midReply: boolean }): Promise<void> {
	await page.locator('body').evaluate(async (body, midReply) => {
		const doc = body.ownerDocument;
		const view = doc.defaultView;
		const buffered = (): number[] =>
			[...doc.querySelectorAll('[data-buffered-characters]')].map((element) =>
				Number(element.getAttribute('data-buffered-characters')),
			);
		if (midReply) {
			await new Promise<void>((resolve) => {
				const watch = new view.MutationObserver(() => {
					if (!buffered().some((count) => count > 0)) return;
					watch.disconnect();
					resolve();
				});
				watch.observe(body, { subtree: true, attributeFilter: ['data-buffered-characters'] });
			});
		}
		const state: WhileHidden = { bufferedCharacters: [], transcriptAnimations: 0 };
		Reflect.set(view, 'whileHidden', state);
		const prototype = view.HTMLElement.prototype;
		const animate = prototype.animate;
		prototype.animate = function (this: typeof body, ...args: Parameters<typeof animate>) {
			if (this.closest('[data-testid="chat-message-list"]')) state.transcriptAnimations += 1;
			return animate.apply(this, args);
		};
		Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
		Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'hidden' });
		doc.dispatchEvent(new view.Event('visibilitychange'));
		const sample = (): void => {
			state.bufferedCharacters.push(...buffered());
		};
		new view.MutationObserver(sample).observe(body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributeFilter: ['data-buffered-characters'],
		});
		await new Promise((resolve) => view.setTimeout(resolve, 0));
		sample();
	}, midReply);
}

async function showWindow(page: Page): Promise<void> {
	await page.locator('body').evaluate((body) => {
		const doc = body.ownerDocument;
		const view = doc.defaultView;
		Reflect.deleteProperty(view.HTMLElement.prototype, 'animate');
		Reflect.deleteProperty(doc, 'hidden');
		Reflect.deleteProperty(doc, 'visibilityState');
		doc.dispatchEvent(new view.Event('visibilitychange'));
	});
}

async function replyWhileHidden(page: Page): Promise<WhileHidden> {
	await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 30_000,
	});
	await expect(page.locator(LATEST_RUN).getByText(/^Streamed line 40 of 40\.$/)).toBeInViewport();
	const whileHidden: WhileHidden = await page.evaluate(() =>
		Reflect.get(globalThis, 'whileHidden'),
	);
	expect(
		whileHidden.bufferedCharacters.length,
		'streamed text sampled while hidden',
	).toBeGreaterThan(20);
	expect(
		Math.max(...whileHidden.bufferedCharacters),
		'characters held back to type out on return',
	).toBe(0);
	return whileHidden;
}

test('a reply that streams while the window is hidden waits whole and still for the return', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-hidden-return', 'Away');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'STREAM:40 Start talking, I am about to leave');
		await hideWindow(page, { midReply: true });
		await replyWhileHidden(page);
		await showWindow(page);
		await untilStill(page);

		await hideWindow(page, { midReply: false });
		await sendPrompt(page, 'STREAM:40 Talk while I am away');
		const whileHidden = await replyWhileHidden(page);
		expect(whileHidden.transcriptAnimations, 'transcript motion planned while hidden').toBe(0);
		await showWindow(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
