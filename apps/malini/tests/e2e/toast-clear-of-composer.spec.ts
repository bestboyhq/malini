import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	git,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

declare global {
	var footerCoverage: string[];
}

const ARCHIVED_NAME = 'Toast clearance archived workstream';
const SHORT_NAMES = ['Short one', 'Short two'];
const SHORT_SAVED = 'Its commit is saved';
const FOOTER_CONTROLS = '[data-testid="chat-changed-files"], [data-testid="chat-composer"]';

interface Layout {
	name: string;
	width: number;
	sidebar: 'shown' | 'hidden';
	inspector: 'open' | 'compact';
	reducedMotion: 'no-preference' | 'reduce';
}

const LAYOUTS: readonly Layout[] = [
	{
		name: '1280-wide',
		width: 1280,
		sidebar: 'shown',
		inspector: 'open',
		reducedMotion: 'no-preference',
	},
	{
		name: '900-wide',
		width: 900,
		sidebar: 'hidden',
		inspector: 'compact',
		reducedMotion: 'reduce',
	},
	{
		name: '900-wide-inspector-open',
		width: 900,
		sidebar: 'hidden',
		inspector: 'open',
		reducedMotion: 'no-preference',
	},
	{
		name: '1280-wide-no-panels',
		width: 1280,
		sidebar: 'hidden',
		inspector: 'compact',
		reducedMotion: 'reduce',
	},
];

async function commitWork(worktree: string): Promise<void> {
	writeFileSync(join(worktree, 'committed.txt'), 'committed\n');
	await git(worktree, ['add', '.']);
	await git(worktree, ['commit', '-m', 'work']);
}

async function archiveAll(page: Page, names: readonly string[]): Promise<void> {
	const showSidebar = page.getByRole('button', { name: 'Show sidebar' });
	const folded = await showSidebar.isVisible();
	if (folded) await showSidebar.click();
	for (const name of names) await archive(page, name);
	if (folded) await page.keyboard.press('Escape');
}

async function archive(page: Page, name: string): Promise<void> {
	const row = page.getByTestId('sidebar-workstream').filter({ hasText: name });
	const button = page.getByRole('button', { name: `Archive ${name}` });
	await expect(async () => {
		await row.hover();
		await button.click({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

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
						const opened = hit?.closest('[data-sidebar-overlay]');
						if (hit && !opened && !footer?.contains(hit) && covered.length < 20) {
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
	const hideSidebar = page.getByRole('button', { name: 'Hide sidebar' });
	if (layout.sidebar === 'hidden' && (await hideSidebar.isVisible())) await hideSidebar.click();
	await expect(
		page.getByRole('button', {
			name: layout.sidebar === 'hidden' ? 'Show sidebar' : 'Hide sidebar',
		}),
	).toBeVisible();
	const inspector = page.getByTestId('extension-inspector-shell');
	const open = (await inspector.getAttribute('data-inspector-drawer-open')) === 'true';
	if (layout.inspector === 'compact' && open) {
		await page.getByRole('button', { name: 'Hide inspector' }).click();
	}
	if (layout.inspector === 'open' && !open) {
		await page.getByRole('button', { name: 'Show inspector' }).click();
	}
	await expect(inspector).toHaveAttribute(
		'data-inspector-drawer-open',
		layout.inspector === 'open' ? 'true' : 'false',
	);
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

			const source = await createSourceRepo(app.root);
			const archived = await seedWorkstream(
				page,
				source,
				'e2e-toast-clearance-archived-ws',
				ARCHIVED_NAME,
			);
			await commitWork(archived.worktree);
			writeFileSync(join(archived.worktree, 'uncommitted.txt'), 'uncommitted\n');
			for (const [index, name] of SHORT_NAMES.entries()) {
				const short = await seedWorkstream(
					page,
					source,
					`e2e-toast-clearance-short-${index}-ws`,
					name,
				);
				await commitWork(short.worktree);
			}
			const chats = await seedWorkstream(
				page,
				await createSourceRepo(app.root, 'other'),
				'e2e-toast-clearance-chats-ws',
				'Toast clearance chats',
			);
			await openWorkstream(page, chats.workstreamId);
			await sendPrompt(page, 'EDIT:c.txt');
			await expectAssistantReply(page);
			await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByTestId('chat-changed-files')).toBeVisible();
			await watchFooterCoverage(page);

			await archiveAll(page, [...SHORT_NAMES, ARCHIVED_NAME]);
			await setLayout(page, layout);
			await page.mouse.move(4, 4);
			await expect(page.getByTestId('toast').filter({ hasText: 'saved' })).toHaveCount(3, {
				timeout: 20_000,
			});
			await expectClearOfFooter(page, 3);
			await captureFlow(app, `toast-clear-${layout.name}-stack`);

			await expandStack(page);
			await expectClearOfFooter(page, 3);
			await captureFlow(app, `toast-clear-${layout.name}-expanded`);

			await page.mouse.move(4, 4);
			await expectClearOfFooter(page, 3);

			await expect(page.getByTestId('toast').filter({ hasText: SHORT_SAVED })).toHaveCount(0, {
				timeout: 15_000,
			});
			await expectClearOfFooter(page, 1);
			await captureFlow(app, `toast-clear-${layout.name}-single`);
			expect(await page.evaluate(() => globalThis.footerCoverage)).toEqual([]);
			expectCleanConsole(app);
		} finally {
			await app.close();
		}
	});
}
