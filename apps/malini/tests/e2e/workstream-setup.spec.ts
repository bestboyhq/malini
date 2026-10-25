import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	launchMalini,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function workstreamRow(page: Page, workstreamId: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
	);
}

function openedWorkstreamId(page: Page): string | null {
	return /#\/workstreams\/([^?/]+)/u.exec(page.url())?.[1] ?? null;
}

async function newWorkstream(page: Page, repository: string): Promise<string> {
	const before = openedWorkstreamId(page);
	await sidebar(page)
		.locator(`[data-testid="sidebar-connected-repository"][data-full-name="${repository}"]`)
		.hover();
	await sidebar(page)
		.getByRole('button', { name: `New workstream for ${repository}` })
		.click();
	await expect.poll(() => openedWorkstreamId(page), { timeout: 20_000 }).not.toBe(before);
	const opened = openedWorkstreamId(page);
	if (!opened) throw new Error('the new workstream did not open');
	await expect(workstreamRow(page, opened)).toHaveAttribute('aria-current', 'page', {
		timeout: 20_000,
	});
	return opened;
}

async function watchHeadlineOverlaps(
	page: Page,
): Promise<() => Promise<{ texts: string[]; overlaps: string[] }>> {
	const watch = await page.locator('body').evaluateHandle((body) => {
		const doc = body.ownerDocument;
		const texts = new Set<string>();
		const overlaps = new Set<string>();
		const sample = () => {
			const headline = doc.querySelector('[data-testid="global-topbar-github-headline"]');
			if (headline) {
				texts.add(headline.getAttribute('aria-label') ?? '');
				for (const parent of [headline, ...headline.querySelectorAll('*')]) {
					const children = [...parent.children].filter((child) =>
						child.checkVisibility({ opacityProperty: true }),
					);
					children.forEach((child, index) => {
						const a = child.getBoundingClientRect();
						for (const other of children.slice(index + 1)) {
							const b = other.getBoundingClientRect();
							if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
								overlaps.add(`${child.textContent} over ${other.textContent}`);
							}
						}
					});
				}
			}
			doc.defaultView?.requestAnimationFrame(sample);
		};
		sample();
		return { texts, overlaps };
	});
	return () =>
		watch.evaluate(({ texts, overlaps }) => ({ texts: [...texts], overlaps: [...overlaps] }));
}

function composerReady(page: Page) {
	return page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
}

async function commitFiles(repo: string, files: Readonly<Record<string, string>>): Promise<void> {
	for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
	await git(repo, ['add', '.']);
	await git(repo, ['commit', '-m', 'add files']);
}

function installNpmStub(app: LaunchedApp): string {
	const succeeds = join(app.home, 'npm-succeeds');
	const stub = join(app.bin, 'npm');
	writeFileSync(
		stub,
		`#!/bin/sh\nif [ -f "${succeeds}" ]; then exit 0; fi\necho "e2e install failure" 1>&2\nexit 1\n`,
	);
	chmodSync(stub, 0o755);
	return succeeds;
}

test('a new workstream opens at once, sets itself up, and every new workstream joins the sidebar', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, source, 'e2e-setup-first', 'First work');
		await page.reload();
		await expect(workstreamRow(page, 'e2e-setup-first')).toBeVisible({ timeout: 20_000 });

		await seedWorkstream(page, source, 'e2e-setup-second', 'Second work');
		await expect(workstreamRow(page, 'e2e-setup-second')).toBeVisible({ timeout: 20_000 });

		const created = await newWorkstream(page, 'alpha');
		await expect(composerReady(page)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('workstream-provisioning-failure')).toHaveCount(0);
		await expect(sidebar(page).getByTestId('sidebar-workstream')).toHaveCount(3);
		await expect(workstreamRow(page, created)).toHaveAttribute('aria-current', 'page');
		await captureFlow(app, 'workstream-setup-ready');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a failed setup says why above the workstream, retries in place, and removes a failed one', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/permission denied/iu] });
	let lockedDirectory: string | null = null;
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		const seeded = await seedWorkstream(page, source, 'e2e-setup-kept', 'Kept work');
		await page.reload();
		await expect(workstreamRow(page, seeded.workstreamId)).toBeVisible({ timeout: 20_000 });
		lockedDirectory = dirname(seeded.worktree);

		chmodSync(lockedDirectory, 0o555);
		const headlineOverlaps = await watchHeadlineOverlaps(page);
		const retried = await newWorkstream(page, 'alpha');
		const failure = page.getByRole('alert').filter({ hasText: 'has no worktree yet' });
		await expect(failure).toBeVisible({ timeout: 30_000 });
		await expect(failure).toContainText(/permission denied/iu);
		const headline = page
			.getByRole('navigation', { name: 'Global actions' })
			.getByRole('status', { name: 'Needs you · Setup failed' });
		await expect(headline).toBeVisible({ timeout: 30_000 });
		await page.waitForTimeout(1_000);
		const watched = await headlineOverlaps();
		expect(watched.texts).toContain('Needs you · Setup failed');
		expect(watched.texts.some((text) => text.startsWith('Setting up'))).toBe(true);
		expect(watched.overlaps).toEqual([]);
		const labelText = headline.getByText('Needs you', { exact: true });
		const detailText = headline.getByText('Setup failed', { exact: true });
		await expect(labelText).toBeVisible();
		await expect(detailText).toBeVisible();
		const label = await labelText.boundingBox();
		const detail = await detailText.boundingBox();
		expect(label && detail && label.x + label.width <= detail.x).toBe(true);
		await captureFlow(app, 'workstream-setup-failed');

		chmodSync(lockedDirectory, 0o755);
		await failure.getByRole('button', { name: /^Retry setting up / }).click();
		await expect(failure).toHaveCount(0, { timeout: 30_000 });
		await expect(composerReady(page)).toBeVisible({ timeout: 30_000 });
		await expect(workstreamRow(page, retried)).toHaveAttribute('aria-current', 'page');

		chmodSync(lockedDirectory, 0o555);
		const removed = await newWorkstream(page, 'alpha');
		await expect(failure).toBeVisible({ timeout: 30_000 });
		chmodSync(lockedDirectory, 0o755);
		await failure.getByRole('button', { name: /^Remove / }).click();

		await expect(workstreamRow(page, removed)).toHaveCount(0, { timeout: 30_000 });
		await expect.poll(() => openedWorkstreamId(page), { timeout: 20_000 }).not.toBe(removed);
		await expect(
			sidebar(page).locator('[data-testid="sidebar-workstream"][aria-current="page"]'),
		).toHaveCount(1);
		await expect(failure).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		if (lockedDirectory) chmodSync(lockedDirectory, 0o755);
		await app.close();
	}
});

test('a dependency install that fails says why and retries, and an unknown project says none was installed', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/e2e install failure/u] });
	try {
		const { page } = app;
		const succeeds = installNpmStub(app);
		const locked = await createSourceRepo(app.root, 'locked');
		await commitFiles(locked, {
			'package.json': '{ "name": "locked", "version": "1.0.0" }\n',
			'package-lock.json': '{ "name": "locked", "lockfileVersion": 3, "packages": {} }\n',
		});
		const unknown = await createSourceRepo(app.root, 'unknown');
		await commitFiles(unknown, { 'package.json': '{ "name": "unknown" }\n' });
		await seedWorkstream(page, locked, 'e2e-install-locked', 'Locked work');
		await seedWorkstream(page, unknown, 'e2e-install-unknown', 'Unknown work');
		await page.reload();
		await expect(workstreamRow(page, 'e2e-install-locked')).toBeVisible({ timeout: 20_000 });

		const installing = await newWorkstream(page, 'locked');
		const install = page.getByTestId('workstream-dependency-install');
		await expect(install).toContainText('failed · e2e install failure', { timeout: 30_000 });
		await expect(install).toContainText('npm ci');
		await captureFlow(app, 'workstream-dependency-install-failed');

		writeFileSync(succeeds, '');
		await install.getByRole('button', { name: 'Retry' }).click();
		await expect(install).toHaveCount(0, { timeout: 30_000 });
		await expect(workstreamRow(page, installing)).toHaveAttribute('aria-current', 'page');

		await newWorkstream(page, 'unknown');
		await expect(install).toContainText(
			'Nothing here says how to install dependencies, so none were installed.',
			{ timeout: 30_000 },
		);
		await expect(install.getByRole('button', { name: 'Retry' })).toHaveCount(0);
		await install.getByRole('button', { name: 'Dismiss' }).click();
		await expect(install).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
