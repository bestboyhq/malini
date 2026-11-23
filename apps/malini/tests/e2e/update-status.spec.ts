import { expect, test } from '@playwright/test';
import type { UpdateStatus } from '../../src/contract/events';
import { createSourceRepo, expectCleanConsole, launchMalini, seedWorkstream } from './harness';

const ready: UpdateStatus = {
	state: 'ready',
	version: '2.4.0',
	installed: '2.2.1',
	releases: [
		{
			version: '2.4.0',
			changes: [
				{ kind: 'feature', summary: 'Pin a chat to the top of its workstream' },
				{ kind: 'fix', summary: 'Keep the scroll position when a turn ends' },
			],
		},
		{ version: '2.3.0', changes: [{ kind: 'perf', summary: 'Open large diffs in one frame' }] },
	],
};

test('a ready update lists every release since the installed version on hover', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedWorkstream(page, await createSourceRepo(app.root), 'e2e-update-ws', 'Update work');
		await app.electronApp.evaluate(({ BrowserWindow }, payload) => {
			for (const window of BrowserWindow.getAllWindows()) {
				window.webContents.send('malini:event', { channel: 'app:update-status-changed', payload });
			}
		}, ready);

		const restart = page.getByRole('button', { name: 'Restart to update to malini 2.4.0' });
		await expect(restart).toBeVisible({ timeout: 20_000 });
		await restart.hover();

		const card = page.getByRole('dialog', { name: 'What changed since 2.2.1' });
		await expect(card).toBeVisible();
		await expect(card.getByRole('heading', { name: '2.4.0' })).toBeVisible();
		await expect(card).toContainText('2 releases behind');
		const releases = card.getByRole('list', { name: 'Releases' }).getByRole('listitem');
		await expect(releases).toHaveCount(2);
		await expect(releases.first()).toContainText('Pin a chat to the top of its workstream');
		await expect(releases.first()).toContainText('Keep the scroll position when a turn ends');
		await expect(releases.last()).toContainText('2.3.0');
		await expect(releases.last()).toContainText('Faster');
		await expect(releases.last()).toContainText('Open large diffs in one frame');

		await page.mouse.move(900, 20);
		await expect(card).toBeHidden();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
