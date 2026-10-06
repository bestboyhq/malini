import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const FILE_COUNT = 20_000;
const BUDGET_MS = 2_000;

async function elapsedMs(step: () => Promise<void>): Promise<number> {
	const started = performance.now();
	await step();
	return performance.now() - started;
}

async function formatInApp(page: Page, count: number): Promise<string> {
	const formatted = await page.evaluate((value) => new Intl.NumberFormat().format(value), count);
	return formatted.replace(/\s/gu, ' ');
}

test('a chat whose run touched twenty thousand files shows and opens its file list promptly', async () => {
	test.setTimeout(300_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-scale-ws', 'Scale workstream');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, `BULK:${FILE_COUNT}`);
		await expect(page.getByTestId('chat-changed-files-toggle')).toBeVisible({ timeout: 180_000 });
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the prompt did not open a chat');

		const files = await formatInApp(page, FILE_COUNT);
		const lines = await formatInApp(page, FILE_COUNT * 3);
		const changedFiles = page.getByRole('region', {
			name: `Files changed in this chat (${files})`,
		});
		const toggle = changedFiles.getByRole('button', {
			name: `${files} files changed in this chat +${lines}`,
		});
		const rows = changedFiles.getByTestId('chat-changed-file');

		await openWorkstream(page, workstreamId, sessionId);
		const barMs = await elapsedMs(() => expect(toggle).toBeVisible({ timeout: 30_000 }));
		expect(barMs).toBeLessThan(BUDGET_MS);
		await expect(rows).toHaveCount(0);
		await captureFlow(app, 'changed-files-scale-collapsed');

		const drawerMs = await elapsedMs(async () => {
			await toggle.click();
			await expect(rows.first()).toBeVisible({ timeout: 30_000 });
		});
		expect(drawerMs).toBeLessThan(BUDGET_MS);
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await captureFlow(app, 'changed-files-scale-expanded');

		await changedFiles.getByTestId('chat-changed-files-scroll').evaluate((list) => {
			list.scrollTop = list.scrollHeight;
		});
		const lastFile = page.getByRole('button', {
			name: 'Open bulk/9/file-4999.txt agent chat diff in Files',
		});
		const lastRow = changedFiles.getByRole('listitem').filter({ has: lastFile });
		await expect(lastRow).toBeVisible();
		await expect(lastRow).toHaveAttribute('aria-posinset', String(FILE_COUNT));

		await toggle.click();
		await expect(rows).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
