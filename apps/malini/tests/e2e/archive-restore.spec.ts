import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ArchivedWorkstreamDto } from '../../src/contract/repositories';
import {
	captureFlow,
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

test('an archived workstream comes back from the archived list with its chat, commits and uncommitted work', async () => {
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
		await expect(async () => {
			await row.hover();
			await archive.click({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });

		await expect(row).toHaveCount(0);
		await expect.poll(() => existsSync(seeded.worktree), { timeout: 30_000 }).toBe(false);
		await expect(page.getByTestId('toast')).toHaveCount(0);
		const [archived] = await invoke<ArchivedWorkstreamDto[]>(
			page,
			'repositories.list-archived-workstreams',
		);
		expect(archived?.id).toBe(seeded.workstreamId);

		const openArchived = page.getByRole('button', { name: 'Archived workstreams' });
		await openArchived.click();
		const restore = page
			.getByRole('menu', { name: 'Archived workstreams' })
			.getByRole('menuitem', { name: `Restore ${archived?.name}` });
		await expect(restore).toBeVisible();
		await captureFlow(app, 'archived-workstreams-menu');
		await restore.click();

		await expect(row).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
		await expectAssistantReply(page);
		expect(readFileSync(join(seeded.worktree, 'seed.txt'), 'utf8')).toBe('seed\nunsaved edit\n');
		expect(readFileSync(join(seeded.worktree, 'committed.txt'), 'utf8')).toBe('committed\n');
		expect(readFileSync(join(seeded.worktree, 'notes.txt'), 'utf8')).toBe(notes);
		await expect(page.getByTestId('toast')).toHaveCount(0);

		await openArchived.click();
		await expect(
			page.getByTestId('archived-workstreams-menu').getByText('Nothing archived yet.'),
		).toBeVisible();
		await captureFlow(app, 'archived-workstream-restored');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
