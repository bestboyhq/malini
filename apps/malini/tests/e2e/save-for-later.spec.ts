import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ArchivedWorkstreamDto } from '../../src/contract/repositories';
import {
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a workstream saved for later waits in its repository scratchpad, comes back from there, or moves to the archive', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		await seedWorkstream(page, beta, 'e2e-later-beta', 'Beta work');
		const seeded = await seedWorkstream(page, alpha, 'e2e-later', 'Later work');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'EDIT:notes.txt');
		await expectAssistantReply(page);
		appendFileSync(join(seeded.worktree, 'seed.txt'), 'unsaved edit\n');

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		const saveForLater = sidebar.getByRole('button', { name: 'Save Later work for later' });
		await clickRevealedOnHover(row, saveForLater);

		await expect(row).toHaveCount(0);
		await expect(
			sidebar.locator('[data-testid="sidebar-workstream"][data-workstream-id="e2e-later-beta"]'),
		).toHaveAttribute('aria-current', 'page');
		await expect.poll(() => existsSync(seeded.worktree), { timeout: 30_000 }).toBe(false);
		await expect(page.getByTestId('toast')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Recently archived' })).toHaveCount(0);
		const [archived] = await invoke<ArchivedWorkstreamDto[]>(
			page,
			'repositories.list-archived-workstreams',
		);
		expect(archived).toMatchObject({ id: seeded.workstreamId, savedForLater: true });

		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		await expect(repository).toHaveAccessibleDescription('1 workstream saved for later');
		await repository.click();
		const shelf = page.getByRole('list', { name: 'Saved for later' });
		const resume = shelf.getByRole('button', { name: 'Resume Later work' });
		await expect(resume).toBeVisible({ timeout: 20_000 });
		await expect(shelf.getByRole('listitem')).toContainText('just now');
		await shelf.getByRole('listitem').hover();
		await captureFlow(app, 'saved-for-later');
		await resume.click();

		await expect(row).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
		await expectAssistantReply(page);
		expect(readFileSync(join(seeded.worktree, 'seed.txt'), 'utf8')).toBe('seed\nunsaved edit\n');
		await expect(repository).toHaveAccessibleDescription('');

		await clickRevealedOnHover(row, saveForLater);
		await expect(row).toHaveCount(0);
		await repository.click();
		await clickRevealedOnHover(
			shelf.getByRole('listitem'),
			shelf.getByRole('button', { name: 'Archive Later work' }),
		);
		await expect(shelf).toHaveCount(0);
		await expect(
			page.getByRole('list', { name: 'Recently archived' }).getByRole('button', {
				name: 'Restore Later work',
				includeHidden: true,
			}),
		).toHaveCount(1);
		expect(
			(await invoke<ArchivedWorkstreamDto[]>(page, 'repositories.list-archived-workstreams'))[0],
		).toMatchObject({ id: seeded.workstreamId, savedForLater: false });
		await expect(page.getByTestId('toast')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
