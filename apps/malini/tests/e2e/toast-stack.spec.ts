import { chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { createServer, type ViteDevServer } from 'vite';
import {
	APP_ROOT,
	E2E_ROOT,
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	seedWorkstream,
	showToastsTogether,
} from './harness';

interface ToastOptions {
	id?: string;
	ttlMs?: number | null;
	action?: { label: string; onclick: () => void };
}

declare global {
	var toast: { info(message: string, options?: ToastOptions): unknown; dismiss(id: string): void };
}

const ARCHIVED_NAME = 'Create the file notes/scratch.txt containing';
const OLDER_NAME = 'Short one';
const NEWER_NAME = 'Short two';
const OLDER_ARCHIVED = `Archived ${OLDER_NAME}`;
const NEWER_ARCHIVED = `Archived ${NEWER_NAME}`;
const KEPT_REASON =
	'Its checkout could not be moved aside (permission denied), so nothing was removed.';
const archiveFailure = (name: string): string => `Could not archive ${name} · ${KEPT_REASON}`;

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
			{ timeout: 20_000 },
		)
		.toEqual({ shown: [...shownMessages].sort(), escaping: [] });
}

async function show(
	page: Page,
	message: string,
	{ id, undo = false, ttlMs = null }: { id?: string; undo?: boolean; ttlMs?: number | null } = {},
): Promise<void> {
	await page.evaluate(
		({ message, id, undo, ttlMs }) => {
			globalThis.toast.info(message, {
				ttlMs,
				...(id === undefined ? {} : { id }),
				...(undo ? { action: { label: 'Undo', onclick: () => undefined } } : {}),
			});
		},
		{ message, id, undo, ttlMs },
	);
}

async function archive(page: Page, name: string): Promise<void> {
	const row = page.getByTestId('sidebar-workstream').filter({ hasText: name });
	const button = page.getByRole('button', { name: `Archive ${name}` });
	await clickRevealedOnHover(row, button);
	await expect(
		page.getByTestId('toast').getByText(archiveFailure(name), { exact: true }),
	).toBeVisible({ timeout: 20_000 });
}

async function leave(page: Page): Promise<void> {
	await page.mouse.move(4, 4);
}

test('a long toast behind newer short ones shows its whole text inside its box without a hover', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/permission denied/u] });
	let lockedDirectory: string | null = null;
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const archived = await seedWorkstream(page, source, 'e2e-toast-archived-ws', ARCHIVED_NAME);
		for (const [index, name] of [OLDER_NAME, NEWER_NAME].entries()) {
			await seedWorkstream(page, source, `e2e-toast-short-${index}-ws`, name);
		}
		await page.reload();
		lockedDirectory = dirname(archived.worktree);
		chmodSync(lockedDirectory, 0o555);

		const messages = [ARCHIVED_NAME, OLDER_NAME, NEWER_NAME].map(archiveFailure);
		const failures = page.getByTestId('toast').filter({ hasText: 'Could not archive' });
		await showToastsTogether(failures, messages.length, async () => {
			for (const name of [ARCHIVED_NAME, OLDER_NAME, NEWER_NAME]) await archive(page, name);
		});

		await leave(page);
		await expectStack(page, messages, messages);
		await captureFlow(app, 'toast-stack-expanded');
		expectCleanConsole(app);
	} finally {
		if (lockedDirectory) chmodSync(lockedDirectory, 0o755);
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
				await show(page, OLDER_ARCHIVED);
				await show(page, NEWER_ARCHIVED);
				const messages = [saved, OLDER_ARCHIVED, NEWER_ARCHIVED];

				await leave(page);
				await expectStack(page, messages, messages);

				await show(page, 'Archived', { id: 'archive' });
				const shorter = ['Archived', OLDER_ARCHIVED, NEWER_ARCHIVED];
				await expectStack(page, shorter, shorter);
				await expect
					.poll(async () => {
						const heights = (await readToastTexts(page, shorter)).map((text) => text.height);
						return Math.max(...heights) - Math.min(...heights);
					}, 'every one-line toast is as tall as the others')
					.toBeLessThan(2);
				expectCleanConsole(app);
			} finally {
				await app.close();
			}
		});
	}

	test('a stack whose hovered toast is dismissed under a still pointer lets the rest time out once the pointer leaves', async () => {
		const app = await launchMalini({ env: { ELECTRON_RENDERER_URL: url } });
		try {
			const { page } = app;
			await expect.poll(() => page.evaluate(() => typeof globalThis.toast)).toBe('object');
			await show(page, 'Archived', { id: 'archive' });
			await show(page, OLDER_ARCHIVED, { ttlMs: 5_000 });
			await show(page, NEWER_ARCHIVED, { ttlMs: 5_000 });
			const hovered = page
				.getByTestId('toast')
				.filter({ has: page.getByText('Archived', { exact: true }) });
			await hovered.hover({ position: { x: 24, y: 3 } });
			const messages = ['Archived', OLDER_ARCHIVED, NEWER_ARCHIVED];
			await expectStack(page, messages, messages);

			await page.evaluate(() => globalThis.toast.dismiss('archive'));
			await expect(hovered).toHaveCount(0);
			await leave(page);
			await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 });
			expectCleanConsole(app);
		} finally {
			await app.close();
		}
	});
});
