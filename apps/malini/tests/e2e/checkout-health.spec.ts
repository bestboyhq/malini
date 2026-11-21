import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const CHECKOUT_GONE =
	/not a git repository: \(null\)|io error: ENOENT|Invalid path '[^']+': No such file|current branch appears to be broken|does not exist|could not read from remote|failed to read commondir|is missing\./u;

async function connectAppWithOrigin(
	root: string,
	page: Page,
): Promise<Record<'source' | 'origin', string>> {
	const source = await createSourceRepo(root, 'app');
	const origin = join(root, 'github', 'acme', 'app.git');
	mkdirSync(join(root, 'github', 'acme'), { recursive: true });
	await git(root, ['clone', '-q', '--bare', source, origin]);
	await git(source, ['remote', 'add', 'origin', origin]);
	await invoke(page, 'repositories.connect', { source: { kind: 'local-folder', path: source } });
	return { source, origin };
}

function setupSteps(page: Page): Locator {
	return page.getByRole('list', { name: 'Workstream setup' }).getByRole('listitem');
}

function checkoutWait(page: Page): Locator {
	return page.getByTestId('chat-checkout-wait');
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
		const source = await createSourceRepo(app.root);
		const { worktree } = await seedWorkstream(page, source, 'e2e-checkout-link-ws', 'Relink');
		await openWorkstream(page, 'e2e-checkout-link-ws');
		const link = join(worktree, '.git');
		const linkText = readFileSync(link, 'utf8');
		rmSync(link);
		await comeBackToTheWindow(page);

		await expect
			.poll(() => (existsSync(link) ? readFileSync(link, 'utf8') : null), { timeout: 30_000 })
			.toBe(linkText);
		await expect(setupSteps(page).filter({ hasText: 'Made a fresh copy' })).toBeVisible();
		await expect(setupSteps(page)).toHaveCount(1);
		await expect(checkoutWait(page)).toBeHidden({ timeout: 30_000 });
		await expect(page.getByText("Couldn't read the worktree")).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
		await expect(page.getByRole('status', { name: /^Needs you/u })).toHaveCount(0);
		await captureFlow(app, 'checkout-repaired-itself');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a checkout Malini cannot clone again names the one fix, in its step and the top bar', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [CHECKOUT_GONE] });
	try {
		const { page, root } = app;
		const { source, origin } = await connectAppWithOrigin(root, page);
		const { basePath } = await seedWorkstream(page, origin, 'e2e-checkout-clone-ws', 'Reclone');
		await openWorkstream(page, 'e2e-checkout-clone-ws');
		renameSync(origin, `${origin}-moved`);
		renameSync(source, `${source}-moved`);
		renameSync(basePath, `${basePath}-moved`);
		await comeBackToTheWindow(page);

		const broken = setupSteps(page).filter({ hasText: /Cannot clone .+ again/u });
		await expect(broken).toContainText('GitHub does not answer', { timeout: 60_000 });
		await expect(
			page.getByRole('status', { name: /^Needs you · Cannot clone .+ again/u }),
		).toBeVisible();
		await expect(page.getByTestId('global-topbar-github-action')).toHaveText('Try again');
		await expect(checkoutWait(page)).toHaveText('Sends once the clone is back');
		await expect(page.getByText(/Prompts wait|Checkout broken|No usable checkout/u)).toHaveCount(0);
		await captureFlow(app, 'checkout-needs-you');

		renameSync(`${origin}-moved`, origin);
		renameSync(`${source}-moved`, source);
		await broken.getByRole('button', { name: 'Try again' }).click();
		const restored = setupSteps(page).filter({ hasText: /Cloned .+ again/u });
		await expect(restored).toContainText('Nothing lost', { timeout: 60_000 });
		await expect(broken).toHaveCount(0);
		await expect(page.getByRole('status', { name: /^Needs you/u })).toHaveCount(0);
		await expect(checkoutWait(page)).toBeHidden();
		await captureFlow(app, 'checkout-fixed-by-try-again');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
