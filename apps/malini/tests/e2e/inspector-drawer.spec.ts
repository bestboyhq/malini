import { execFileSync } from 'node:child_process';
import {
	closeSync,
	constants,
	mkdirSync,
	openSync,
	rmSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	showInspector,
	temporaryRoot,
} from './harness';

function inspectorTab(page: Page, name: string): Locator {
	return page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name, exact: true });
}

function gutter(page: Page): Locator {
	return page.getByTestId('extension-inspector-gutter');
}

async function visit(page: Page, workstreamId: string): Promise<void> {
	await page
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
		.click();
	await expect(page).toHaveURL(new RegExp(`/workstreams/${workstreamId}`, 'u'));
}

test('Changes clicked before the extensions start still opens Files on the changed files', async () => {
	test.setTimeout(120_000);
	const root = temporaryRoot();
	const home = join(root, 'extension-home');
	mkdirSync(home, { recursive: true });
	const registry = join(home, 'local.json');
	execFileSync('mkfifo', [registry]);
	const held: { writer: number | null } = { writer: null };
	const release = (): void => {
		if (held.writer === null) return;
		rmSync(registry);
		writeFileSync(registry, '[]');
		writeSync(held.writer, '[]');
		closeSync(held.writer);
		held.writer = null;
	};
	const app = await launchMalini({ profile: root, env: { MALINI_EXTENSION_HOME: home } });
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-drawer-early-changes',
			'Drawer early changes',
		);
		writeFileSync(join(worktree, 'early.txt'), 'early\n');
		await page.reload();
		await expect
			.poll(
				() => {
					try {
						held.writer = openSync(registry, constants.O_WRONLY | constants.O_NONBLOCK);
						return true;
					} catch {
						return false;
					}
				},
				{ timeout: 20_000 },
			)
			.toBe(true);
		await page.evaluate(
			(next) => {
				globalThis.location.hash = next;
			},
			`#/workstreams/${encodeURIComponent(workstreamId)}`,
		);

		await gutter(page)
			.getByRole('button', { name: /^Changes/u })
			.click({ timeout: 20_000 });
		release();

		await expect(inspectorTab(page, 'Files')).toHaveAttribute('aria-selected', 'true', {
			timeout: 20_000,
		});
		await expect(
			page.getByRole('button', { name: 'Remove the changed files filter' }),
		).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
		await expect(page.getByRole('treeitem', { name: 'Open early.txt' })).toBeVisible();
		await expect(page.getByRole('treeitem', { name: 'Open seed.txt' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		release();
		await app.close();
	}
});

test('the inspector starts closed, its Changes row opens Files on the changed files, and each workstream keeps its own drawer, files and picked tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const alpha = await seedWorkstream(page, source, 'e2e-drawer-alpha', 'Drawer alpha');
		const beta = await seedWorkstream(page, source, 'e2e-drawer-beta', 'Drawer beta');
		writeFileSync(join(alpha.worktree, 'alpha-only.txt'), 'alpha\n');
		writeFileSync(join(beta.worktree, 'beta-only.txt'), 'beta\n');
		await openWorkstream(page, alpha.workstreamId);

		await expect(gutter(page)).toBeVisible({ timeout: 20_000 });
		await expect(gutter(page).getByRole('button', { name: 'Browser', exact: true })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Inspector' }).getByRole('tab')).toHaveCount(0);
		const changesRow = gutter(page).getByRole('button', { name: /^Changes/u });
		await expect(changesRow).toHaveCount(1);
		await expect(gutter(page).getByRole('button', { name: /^Files/u })).toHaveCount(0);
		await expect(changesRow.getByLabel('1 additions, 0 deletions')).toBeVisible({
			timeout: 20_000,
		});
		writeFileSync(join(alpha.worktree, 'alpha-only.txt'), 'alpha\nmore\nlines\n');
		await expect(changesRow.getByLabel('3 additions, 0 deletions')).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'inspector-drawer-gutter');

		await visit(page, beta.workstreamId);
		await gutter(page).getByRole('button', { name: 'Show inspector' }).click();
		await expect(gutter(page)).toHaveCount(0);
		await expect(inspectorTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('treeitem', { name: 'Open beta-only.txt' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByRole('treeitem', { name: 'Open alpha-only.txt' })).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Filter to files changed in this workstream' }),
		).toHaveAttribute('aria-pressed', 'false');
		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
		await expect(inspectorTab(page, 'New tab')).toHaveAttribute('aria-selected', 'true');

		await visit(page, alpha.workstreamId);
		await expect(gutter(page)).toBeVisible();
		await changesRow.click();
		await expect(gutter(page)).toHaveCount(0);
		await expect(inspectorTab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
		await expect(
			page.getByRole('button', { name: 'Remove the changed files filter' }),
		).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('treeitem', { name: 'Open alpha-only.txt' })).toBeVisible();
		await expect(page.getByRole('treeitem', { name: 'Open README.md' })).toHaveCount(0);
		await expect(page.getByRole('treeitem', { name: 'Open beta-only.txt' })).toHaveCount(0);
		await captureFlow(app, 'inspector-drawer-changes');

		await visit(page, beta.workstreamId);
		await expect(inspectorTab(page, 'New tab')).toHaveAttribute('aria-selected', 'true');
		await expect(inspectorTab(page, 'Files')).toHaveAttribute('aria-selected', 'false');
		await page.getByRole('button', { name: 'Hide inspector' }).click();
		await expect(gutter(page)).toBeVisible();

		await page.reload();
		await expect(page).toHaveURL(new RegExp(`/workstreams/${beta.workstreamId}`, 'u'));
		await expect(gutter(page)).toBeVisible({ timeout: 20_000 });
		await visit(page, alpha.workstreamId);
		await expect(inspectorTab(page, 'Files')).toHaveAttribute('aria-selected', 'true', {
			timeout: 20_000,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the inspector resize handle lets go once the mouse moves with no button held, even when the release was never seen', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-drawer-resize',
			'Drawer resize',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		await expect(inspectorTab(page, 'Files')).toBeVisible({ timeout: 20_000 });
		const handle = page.getByRole('separator', { name: 'Resize workstream-transcript' });
		const box = await handle.boundingBox();
		if (!box) throw new Error('the resize handle is not laid out');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const start = Number(await handle.getAttribute('aria-valuenow'));

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 40, y, { steps: 4 });
		await expect
			.poll(async () => Number(await handle.getAttribute('aria-valuenow')))
			.not.toBe(start);
		const dragged = Number(await handle.getAttribute('aria-valuenow'));

		await handle.dispatchEvent('pointermove', {
			clientX: x - 80,
			clientY: y,
			buttons: 0,
			pointerId: 1,
			pointerType: 'mouse',
			isPrimary: true,
		});
		await page.mouse.move(x - 160, y, { steps: 4 });
		await page.mouse.up();
		await expect(handle).toHaveAttribute('aria-valuenow', String(dragged));
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
