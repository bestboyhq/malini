import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { createServer, type ViteDevServer } from 'vite';
import {
	APP_ROOT,
	E2E_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	launchMalini,
	listSessions,
	seedTwoChats,
	seedWorkstream,
} from './harness';

interface ToastOptions {
	id?: string;
	ttlMs?: number | null;
	action?: { label: string; onclick: () => void };
}

declare global {
	var toast: { info(message: string, options?: ToastOptions): unknown };
}

const ARCHIVED_NAME = 'Create the file notes/scratch.txt containing';
const CHAT_CLOSED = 'Agent chat closed';

interface ToastText {
	message: string;
	shown: boolean;
	inside: boolean;
	uncovered: boolean;
	height: number;
}

async function readToastText(message: string, text: Locator): Promise<ToastText> {
	return text.evaluate((node, message) => {
		const toast = node.closest('[data-testid="toast"]');
		if (!toast) throw new Error(`"${message}" is not inside a toast`);
		const box = toast.getBoundingClientRect();
		const own = node.getBoundingClientRect();
		const onTop = (x: number, y: number): boolean =>
			node.ownerDocument.elementFromPoint(x, y)?.closest('[data-testid="toast"]') === toast;
		return {
			message,
			shown: node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
			inside:
				own.left >= box.left - 1 &&
				own.right <= box.right + 1 &&
				own.top >= box.top - 1 &&
				own.bottom <= box.bottom + 1,
			uncovered:
				onTop(own.left + 2, own.top + 2) &&
				onTop(own.right - 2, own.bottom - 2) &&
				onTop((own.left + own.right) / 2, (own.top + own.bottom) / 2),
			height: box.height,
		};
	}, message);
}

async function readToastTexts(page: Page, messages: readonly string[]): Promise<ToastText[]> {
	const texts: ToastText[] = [];
	for (const message of new Set(messages)) {
		const matches = page.getByTestId('toast').getByText(message, { exact: true });
		for (const text of await matches.all()) texts.push(await readToastText(message, text));
	}
	return texts;
}

async function expectStack(
	page: Page,
	messages: readonly string[],
	shownMessages: readonly string[],
): Promise<void> {
	await expect
		.poll(
			async () => {
				const texts = await readToastTexts(page, messages);
				return {
					shown: texts
						.filter((text) => text.shown)
						.map((text) => text.message)
						.sort(),
					escaping: texts
						.filter((text) => text.shown && !(text.inside && text.uncovered))
						.map((text) => text.message),
				};
			},
			{ timeout: 5_000 },
		)
		.toEqual({ shown: [...shownMessages].sort(), escaping: [] });
}

async function show(
	page: Page,
	message: string,
	{ id, undo = false }: { id?: string; undo?: boolean } = {},
): Promise<void> {
	await page.evaluate(
		({ message, id, undo }) => {
			globalThis.toast.info(message, {
				ttlMs: null,
				...(id === undefined ? {} : { id }),
				...(undo ? { action: { label: 'Undo', onclick: () => undefined } } : {}),
			});
		},
		{ message, id, undo },
	);
}

async function collapse(page: Page): Promise<void> {
	await page.mouse.move(4, 4);
}

async function expand(page: Page, messages: readonly string[]): Promise<void> {
	await expect(async () => {
		const boxes = await Promise.all(
			(await page.getByTestId('toast').all()).map((toast) => toast.boundingBox()),
		);
		const lowest = Math.max(...boxes.map((box) => (box ? box.y + box.height : 0)));
		const front = boxes.find((box) => box && box.y + box.height === lowest);
		if (!front) throw new Error('no toast is on screen to hover');
		await page.mouse.move(front.x + front.width - 8, front.y + front.height / 2);
		const texts = await readToastTexts(page, messages);
		expect(texts.map((text) => text.shown)).toEqual(messages.map(() => true));
	}).toPass({ timeout: 5_000 });
}

test('a long toast behind newer short ones keeps its text inside its box, collapsed and expanded', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const archived = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-toast-archived-ws',
			ARCHIVED_NAME,
		);
		writeFileSync(join(archived.worktree, 'committed.txt'), 'committed\n');
		await git(archived.worktree, ['add', '.']);
		await git(archived.worktree, ['commit', '-m', 'work']);
		writeFileSync(join(archived.worktree, 'uncommitted.txt'), 'uncommitted\n');
		const chats = await seedTwoChats(
			page,
			await createSourceRepo(app.root, 'other'),
			'e2e-toast-chats-ws',
			'Toast chats',
		);
		const sessions = await listSessions(page, chats.workstreamId);

		const row = page.getByTestId('sidebar-workstream').filter({ hasText: ARCHIVED_NAME });
		const archive = page.getByRole('button', { name: `Archive ${ARCHIVED_NAME}` });
		await expect(async () => {
			await row.hover();
			await archive.click({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });
		const savedWork = page
			.getByTestId('toast')
			.filter({ hasText: 'Its commit and uncommitted work are saved' });
		await expect(savedWork).toBeVisible({ timeout: 20_000 });
		const archivedMessage = (await savedWork.innerText()).trim().replace(/\nCopy ref$/, '');

		for (const session of sessions) {
			const tab = page.getByTestId('chat-agent-tab').filter({ hasText: session.displayName });
			const close = page.getByRole('button', { name: `Close ${session.displayName}` });
			await expect(async () => {
				await tab.hover();
				await close.click({ timeout: 1_000 });
			}).toPass({ timeout: 10_000 });
		}
		const messages = [archivedMessage, CHAT_CLOSED, CHAT_CLOSED];
		await expect(page.getByTestId('toast').filter({ hasText: CHAT_CLOSED })).toHaveCount(2);

		await expectStack(page, messages, [CHAT_CLOSED]);
		await expand(page, messages);
		await expectStack(page, messages, messages);
		await captureFlow(app, 'toast-stack-expanded');

		await collapse(page);
		await expectStack(page, messages, [CHAT_CLOSED]);
		await captureFlow(app, 'toast-stack-collapsed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test.describe('a hyper-ui toast in the app window', () => {
	let server: ViteDevServer | undefined;
	let url = '';

	test.beforeAll(async () => {
		server = await createServer({
			configFile: false,
			root: join(E2E_ROOT, 'fixtures'),
			logLevel: 'error',
			plugins: [tailwindcss(), svelte({ configFile: false, preprocess: vitePreprocess() })],
			resolve: { alias: { '$hyper-ui': resolve(APP_ROOT, '../../packages/hyper-ui/src') } },
			server: { port: 41_730, fs: { allow: [resolve(APP_ROOT, '../..')] } },
		});
		await server.listen();
		const [origin] = server.resolvedUrls?.local ?? [];
		if (!origin) throw new Error('the toast fixture server has no local url');
		url = new URL('toast-host.html', origin).href;
	});

	test.afterAll(async () => {
		await server?.close();
	});

	for (const reducedMotion of ['no-preference', 'reduce'] as const) {
		test(`updated in place to a longer, then a shorter message, keeps its text inside its box (reduced motion: ${reducedMotion})`, async () => {
			const app = await launchMalini({ env: { ELECTRON_RENDERER_URL: url } });
			try {
				const { page } = app;
				await page.emulateMedia({ reducedMotion });
				await expect.poll(() => page.evaluate(() => typeof globalThis.toast)).toBe('object');
				const archived = `Archived ${ARCHIVED_NAME}`;
				const saved = `${archived} · Saved 1 commit and uncommitted work to refs/malini/archived/01JB3ABBAC5477E451B88253FA`;

				await show(page, archived, { id: 'archive', undo: true });
				await show(page, saved, { id: 'archive' });
				await show(page, CHAT_CLOSED);
				await show(page, CHAT_CLOSED);
				const messages = [saved, CHAT_CLOSED, CHAT_CLOSED];

				await collapse(page);
				await expectStack(page, messages, [CHAT_CLOSED]);

				await expand(page, messages);
				await expectStack(page, messages, messages);

				await show(page, 'Archived', { id: 'archive' });
				const shorter = ['Archived', CHAT_CLOSED, CHAT_CLOSED];
				await expectStack(page, shorter, shorter);
				await expect
					.poll(async () => {
						const heights = (await readToastTexts(page, shorter)).map((text) => text.height);
						return Math.max(...heights) - Math.min(...heights);
					}, 'every one-line toast is as tall as the others')
					.toBeLessThan(2);

				await collapse(page);
				await expectStack(page, shorter, [CHAT_CLOSED]);
				expectCleanConsole(app);
			} finally {
				await app.close();
			}
		});
	}
});
