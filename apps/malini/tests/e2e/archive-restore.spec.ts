import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ArchivedWorkstreamDto } from '../../src/contract/repositories';
import {
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('an archived workstream comes back from its repository in the sidebar with its chat, commits and uncommitted work', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-restore-other', 'Other work');
		const seeded = await seedWorkstream(page, source, 'e2e-restore-ws', 'Restorable work');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'EDIT:notes.txt');
		await expectAssistantReply(page);
		writeFileSync(join(seeded.worktree, 'committed.txt'), 'committed\n');
		await git(seeded.worktree, ['add', 'committed.txt']);
		await git(seeded.worktree, [
			'-c',
			'user.email=e2e@example.com',
			'-c',
			'user.name=e2e',
			'commit',
			'-m',
			'work',
		]);
		appendFileSync(join(seeded.worktree, 'seed.txt'), 'unsaved edit\n');
		const notes = readFileSync(join(seeded.worktree, 'notes.txt'), 'utf8');

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		const archive = sidebar.locator(
			`[data-testid="sidebar-archive-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		await clickRevealedOnHover(row, archive);

		await expect(row).toHaveCount(0);
		await expect(
			sidebar.locator('[data-testid="sidebar-workstream"][data-workstream-id="e2e-restore-other"]'),
		).toHaveAttribute('aria-current', 'page');
		await expect.poll(() => existsSync(seeded.worktree), { timeout: 30_000 }).toBe(false);
		await expect(page.getByTestId('toast')).toHaveCount(0);
		const [archived] = await invoke<ArchivedWorkstreamDto[]>(
			page,
			'repositories.list-archived-workstreams',
		);
		expect(archived?.id).toBe(seeded.workstreamId);

		await expect(page.getByRole('button', { name: 'Show all' })).toHaveCount(0);
		const archivedRow = page.locator(
			`[data-testid="sidebar-archived-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		await expect(archivedRow).toContainText(archived?.name ?? '');
		await expect(archivedRow).toContainText('just now');
		await expect(
			archivedRow.getByRole('button', { name: /^Open pull request/u, includeHidden: true }),
		).toHaveCount(0);
		await archivedRow.hover();
		await captureFlow(app, 'sidebar-archived-workstreams');
		await clickRevealedOnHover(
			archivedRow,
			page.getByRole('button', { name: `Restore ${archived?.name}` }),
		);

		await expect(row).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
		await expectAssistantReply(page);
		expect(readFileSync(join(seeded.worktree, 'seed.txt'), 'utf8')).toBe('seed\nunsaved edit\n');
		expect(readFileSync(join(seeded.worktree, 'committed.txt'), 'utf8')).toBe('committed\n');
		expect(readFileSync(join(seeded.worktree, 'notes.txt'), 'utf8')).toBe(notes);
		await expect(page.getByTestId('toast')).toHaveCount(0);

		await expect(page.getByRole('heading', { name: 'Recently archived' })).toHaveCount(0);
		await captureFlow(app, 'archived-workstream-restored');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a read that reaches a workstream after its archive says it was retired and logs no error', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-archived-then-read', 'Archived late');
		await invoke(page, 'repositories.archive-workstream', { workstreamId: seeded.workstreamId });
		await expect.poll(() => existsSync(seeded.worktree), { timeout: 30_000 }).toBe(false);

		for (const command of [
			'repositories.workstream-diff',
			'repositories.workstream-status',
			'repositories.workstream-files',
		]) {
			await expect(invoke(page, command, { workstreamId: seeded.workstreamId })).rejects.toThrow(
				/archived or deleted/u,
			);
		}
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('archiving a workstream stops the command its agent left running in the background', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-archive-dev-server', 'Dev server work');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'BACKGROUND_COMMAND');
		await expect(page.getByRole('region', { name: '1 background command running' })).toBeVisible({
			timeout: 20_000,
		});

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		const archive = sidebar.locator(
			`[data-testid="sidebar-archive-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		await clickRevealedOnHover(row, archive);

		await expect.poll(() => existsSync(seeded.worktree), { timeout: 30_000 }).toBe(false);
		await expect(row).toHaveCount(0);
		await expect(page.getByTestId('toast')).toHaveCount(0);
		expect(
			await invoke(page, 'chat.workstream-has-open-run', { workstreamId: seeded.workstreamId }),
		).toBe(false);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('recently archived starts short, shows all on request and keeps the height its top edge is dragged to', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-archived-active', 'Still going');
		for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
			await seedWorkstream(page, source, `e2e-archived-${letter}`, `Archived ${letter}`);
			await invoke(page, 'repositories.archive-workstream', {
				workstreamId: `e2e-archived-${letter}`,
			});
		}

		const list = page.getByRole('list', { name: 'Recently archived' });
		const rows = list.getByRole('listitem');
		await expect(rows).toHaveCount(8, { timeout: 20_000 });
		await expect(rows.first()).toHaveAttribute('data-workstream-id', 'e2e-archived-h');
		await expect(rows.last()).toHaveAttribute('data-workstream-id', 'e2e-archived-a');
		await expect(rows.nth(1)).toBeInViewport({ ratio: 1 });
		await expect(rows.nth(4)).not.toBeInViewport();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'sidebar-archived-list');

		const showAll = page.getByRole('button', { name: 'Show all' });
		await showAll.click();
		await expect(rows.last()).toBeInViewport({ ratio: 1 });
		await page.mouse.move(0, 0);
		await captureFlow(app, 'sidebar-archived-list-all');
		await page.getByRole('button', { name: 'Show less' }).click();
		await expect(rows.nth(4)).not.toBeInViewport();

		const edge = page.getByRole('slider', { name: 'Recently archived height' });
		const before = Number(await edge.getAttribute('aria-valuenow'));
		const box = await edge.boundingBox();
		if (!box) throw new Error('the recently archived edge has no box');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 72, { steps: 6 });
		await page.mouse.up();
		await expect(edge).toHaveAttribute('aria-valuenow', String(before + 72));
		await expect(rows.nth(4)).toBeInViewport({ ratio: 1 });

		await page.reload();
		await expect(page.getByRole('slider', { name: 'Recently archived height' })).toHaveAttribute(
			'aria-valuenow',
			String(before + 72),
			{ timeout: 20_000 },
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
