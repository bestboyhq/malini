import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

function setupSteps(page: Page): Locator {
	return page.getByRole('list', { name: 'Workstream setup' }).getByRole('listitem');
}

async function comeBackToTheWindow(page: Page): Promise<void> {
	await page.evaluate(`globalThis.dispatchEvent(new Event('focus'))`);
}

test('a checkout that lost its link to git links itself again and asks for nothing', async () => {
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

		await expect
			.poll(() => (existsSync(link) ? readFileSync(link, 'utf8') : null), { timeout: 30_000 })
			.toBe(linkText);
		await expect(setupSteps(page).filter({ hasText: 'Made a fresh copy' })).toBeVisible();
		await expect(setupSteps(page)).toHaveCount(1);
		await expect(page.getByText(/^Prompts wait/u)).toBeHidden({ timeout: 30_000 });
		await expect(page.getByText("Couldn't read the worktree")).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Repair/u })).toHaveCount(0);
		await captureFlow(app, 'checkout-repaired-itself');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a checkout whose repository is gone names the instruction in its step and has no Repair', async () => {
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

		const broken = setupSteps(page).filter({
			hasText: 'The repository behind this checkout is gone',
		});
		await expect(broken).toContainText(
			'Put the repository folder back, or archive this workstream',
			{ timeout: 30_000 },
		);
		await expect(broken.getByRole('button', { name: 'Repair' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Repair/u })).toHaveCount(0);
		await expect(page.getByRole('status', { name: 'Needs you · Checkout broken' })).toBeVisible();
		await expect(page.getByText('Prompts wait until the checkout works again')).toBeVisible();
		await expect(page.getByTestId('chat-surface').locator('> *')).toHaveCount(1);
		await captureFlow(app, 'checkout-step');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
