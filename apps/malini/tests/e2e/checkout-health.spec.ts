import { readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	type LaunchedApp,
	type SeededWorkstream,
} from './harness';

async function openSeededWorkstream(
	app: LaunchedApp,
	workstreamId: string,
): Promise<SeededWorkstream> {
	const source = await createSourceRepo(app.root);
	const seeded = await seedWorkstream(app.page, source, workstreamId, 'Checkout health');
	await openWorkstream(app.page, seeded.workstreamId);
	return seeded;
}

async function comeBackToTheWindow(page: Page): Promise<void> {
	await page.evaluate(`globalThis.dispatchEvent(new Event('focus'))`);
}

test('a checkout that lost its link to git shows a banner, and Repair links it again', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		allowedDiagnostics: [/The folder e2e-checkout-link-ws is missing\./u],
	});
	try {
		const { page } = app;
		const { worktree } = await openSeededWorkstream(app, 'e2e-checkout-link-ws');
		const link = join(worktree, '.git');
		const linkText = readFileSync(link, 'utf8');
		rmSync(link);
		await comeBackToTheWindow(page);

		const banner = page.getByRole('alert', { name: 'This folder lost its link to git' });
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toContainText('Repair links it again. Your files stay');
		await expect(page.getByText('Prompts wait until the checkout works again')).toBeVisible();
		await expect(page.getByText("Couldn't read the worktree")).toHaveCount(0);
		await captureFlow(app, 'checkout-banner');

		await banner.getByRole('button', { name: 'Repair' }).click();
		await expect(banner).toBeHidden({ timeout: 30_000 });
		await expect(page.getByText(/^Prompts wait/u)).toBeHidden({ timeout: 30_000 });
		expect(readFileSync(link, 'utf8')).toBe(linkText);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a checkout whose repository is gone shows the instruction and no Repair', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		allowedDiagnostics: [
			/not a git repository: \(null\)|io error: ENOENT|Invalid path '[^']+': No such file|current branch appears to be broken/u,
		],
	});
	try {
		const { page } = app;
		const { basePath } = await openSeededWorkstream(app, 'e2e-checkout-base-ws');
		renameSync(basePath, `${basePath}-moved`);
		await comeBackToTheWindow(page);

		const banner = page.getByRole('alert', {
			name: 'The repository behind this checkout is gone',
		});
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toContainText(
			'Put the repository folder back, or archive this workstream',
		);
		await expect(banner.getByRole('button', { name: 'Repair' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
