import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	git,
	launchMalini,
	listSessions,
	seedTwoChats,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
} from './harness';

declare global {
	var footerCoverage: string[];
}

const ARCHIVED_NAME = 'Toast clearance archived workstream';
const CHAT_CLOSED = 'Agent chat closed';
const FOOTER_CONTROLS = '[data-testid="chat-changed-files"], [data-testid="chat-composer"]';

interface Layout {
	name: string;
	width: number;
	sidebar: 'shown' | 'hidden';
	inspector: 'shown' | 'hidden';
	reducedMotion: 'no-preference' | 'reduce';
}

const LAYOUTS: readonly Layout[] = [
	{
		name: '1280-wide',
		width: 1280,
		sidebar: 'shown',
		inspector: 'shown',
		reducedMotion: 'no-preference',
	},
	{ name: '900-wide', width: 900, sidebar: 'shown', inspector: 'shown', reducedMotion: 'reduce' },
	{
		name: '900-wide-no-inspector',
		width: 900,
		sidebar: 'shown',
		inspector: 'hidden',
		reducedMotion: 'no-preference',
	},
	{
		name: '1280-wide-no-panels',
		width: 1280,
		sidebar: 'hidden',
		inspector: 'hidden',
		reducedMotion: 'reduce',
	},
];

async function watchFooterCoverage(page: Page): Promise<void> {
	await page.locator('body').evaluate((body, selector) => {
		const covered: string[] = [];
		globalThis.footerCoverage = covered;
		const sample = (): void => {
			const footer = body.ownerDocument.querySelector('[data-testid="chat-footer-stack"]');
			for (const control of footer?.querySelectorAll(selector) ?? []) {
				const box = control.getBoundingClientRect();
				for (let column = 0; column <= 12 && box.width > 0; column += 1) {
					for (let row = 0; row <= 3; row += 1) {
						const x = box.left + 2 + ((box.width - 4) * column) / 12;
						const y = box.top + 2 + ((box.height - 4) * row) / 3;
						const hit = body.ownerDocument.elementFromPoint(x, y);
						if (hit && !footer?.contains(hit) && covered.length < 20) {
							const toast = hit.closest('[data-testid="toast"]');
							covered.push(
								`${Math.round(x)},${Math.round(y)}: ${toast?.textContent ?? hit.tagName}`,
							);
						}
					}
				}
			}
			body.ownerDocument.defaultView?.requestAnimationFrame(() => setTimeout(sample));
		};
		sample();
	}, FOOTER_CONTROLS);
}

async function readClearance(
	page: Page,
): Promise<{ toasts: number; overFooter: string[]; sendOnTop: boolean }> {
	const send = page.getByRole('button', { name: 'Send prompt' });
	return send.evaluate((button, selector) => {
		const controls = [...button.ownerDocument.querySelectorAll(selector)].map((control) =>
			control.getBoundingClientRect(),
		);
		const toasts = [...button.ownerDocument.querySelectorAll('[data-testid="toast"]')].filter(
			(toast) => toast.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
		);
		const overFooter = toasts
			.filter((toast) => {
				const own = toast.getBoundingClientRect();
				return controls.some(
					(box) =>
						own.left < box.right &&
						own.right > box.left &&
						own.top < box.bottom &&
						own.bottom > box.top,
				);
			})
			.map((toast) => toast.textContent?.trim() ?? '');
		const own = button.getBoundingClientRect();
		const hit = button.ownerDocument.elementFromPoint(
			own.left + own.width / 2,
			own.top + own.height / 2,
		);
		return { toasts: toasts.length, overFooter, sendOnTop: hit !== null && button.contains(hit) };
	}, FOOTER_CONTROLS);
}

async function expectClearOfFooter(page: Page, toasts: number): Promise<void> {
	await expect
		.poll(() => readClearance(page), { timeout: 5_000 })
		.toEqual({ toasts, overFooter: [], sendOnTop: true });
}

async function expandStack(page: Page): Promise<void> {
	await expect(async () => {
		const boxes = await Promise.all(
			(await page.getByTestId('toast').all()).map((toast) => toast.boundingBox()),
		);
		const lowest = Math.max(...boxes.map((box) => (box ? box.y + box.height : 0)));
		const front = boxes.find((box) => box && box.y + box.height === lowest);
		if (!front) throw new Error('no toast is on screen to hover');
		await page.mouse.move(front.x + front.width - 8, front.y + front.height / 2);
		const tops = boxes.map((box) => (box ? box.y : 0)).sort((a, b) => a - b);
		const spread = (tops.at(-1) ?? 0) - (tops[0] ?? 0);
		expect(spread).toBeGreaterThan(front.height);
	}).toPass({ timeout: 5_000 });
}

async function setLayout(page: Page, layout: Layout): Promise<void> {
	if (layout.sidebar === 'hidden') {
		await page.getByRole('button', { name: 'Hide sidebar' }).click();
		await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
	}
	if (layout.inspector === 'hidden') {
		await page.getByRole('button', { name: 'Hide inspector' }).click();
		await expect(page.getByRole('button', { name: 'Show inspector' })).toBeVisible();
	}
}

for (const layout of LAYOUTS) {
	test(`toasts never cover the composer or the changed files above it, alone, stacked or expanded (${layout.name})`, async () => {
		test.setTimeout(120_000);
		const app = await launchMalini();
		try {
			const { page, electronApp } = app;
			await page.emulateMedia({ reducedMotion: layout.reducedMotion });
			await electronApp.evaluate(
				({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setContentSize(width, 800),
				layout.width,
			);
			await expect
				.poll(() =>
					page.locator('body').evaluate((body) => body.ownerDocument.defaultView?.innerWidth),
				)
				.toBe(layout.width);

			const archived = await seedWorkstream(
				page,
				await createSourceRepo(app.root),
				'e2e-toast-clearance-archived-ws',
				ARCHIVED_NAME,
			);
			writeFileSync(join(archived.worktree, 'committed.txt'), 'committed\n');
			await git(archived.worktree, ['add', '.']);
			await git(archived.worktree, ['commit', '-m', 'work']);
			writeFileSync(join(archived.worktree, 'uncommitted.txt'), 'uncommitted\n');
			const chats = await seedTwoChats(
				page,
				await createSourceRepo(app.root, 'other'),
				'e2e-toast-clearance-chats-ws',
				'Toast clearance chats',
			);
			await startFreshChat(page);
			await sendPrompt(page, 'EDIT:c.txt');
			await expectAssistantReply(page);
			const openChat = currentSessionId(page);
			const closing = (await listSessions(page, chats.workstreamId)).filter(
				(session) => session.id !== openChat,
			);
			await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByTestId('chat-changed-files')).toBeVisible();
			await watchFooterCoverage(page);

			const row = page.getByTestId('sidebar-workstream').filter({ hasText: ARCHIVED_NAME });
			const archive = page.getByRole('button', { name: `Archive ${ARCHIVED_NAME}` });
			await expect(async () => {
				await row.hover();
				await archive.click({ timeout: 1_000 });
			}).toPass({ timeout: 20_000 });
			await expect(
				page.getByTestId('toast').filter({ hasText: 'Its commit and uncommitted work are saved' }),
			).toBeVisible({
				timeout: 20_000,
			});
			await setLayout(page, layout);
			await page.mouse.move(4, 4);
			await expectClearOfFooter(page, 1);
			await captureFlow(app, `toast-clear-${layout.name}-single`);

			for (const session of closing) {
				const tab = page.getByTestId('chat-agent-tab').filter({ hasText: session.displayName });
				const close = page.getByRole('button', { name: `Close ${session.displayName}` });
				await expect(async () => {
					await tab.hover();
					await close.click({ timeout: 1_000 });
				}).toPass({ timeout: 10_000 });
			}
			await expect(page.getByTestId('toast').filter({ hasText: CHAT_CLOSED })).toHaveCount(2);
			await page.mouse.move(4, 4);
			await expectClearOfFooter(page, 3);
			await captureFlow(app, `toast-clear-${layout.name}-stack`);

			await expandStack(page);
			await expectClearOfFooter(page, 3);
			await captureFlow(app, `toast-clear-${layout.name}-expanded`);

			await page.mouse.move(4, 4);
			await expectClearOfFooter(page, 3);
			expect(await page.evaluate(() => globalThis.footerCoverage)).toEqual([]);
			expectCleanConsole(app);
		} finally {
			await app.close();
		}
	});
}
