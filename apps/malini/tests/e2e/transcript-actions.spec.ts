import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a failed command says why on its row, an edit shows its size on its row, and a code block copies its code', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-transcript-actions-ws',
			'Transcript actions workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'BASH_FAIL EDIT_TOOL CODE');
		await expectAssistantReply(page);
		await expect(page.getByText('ESLint found 3 problems', { exact: true })).toBeVisible();
		await expect(page.getByLabel('2 lines added, 1 line removed')).toBeVisible();

		await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''));
		await page.getByRole('button', { name: 'Copy code' }).click();
		await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
		await expect
			.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
			.toBe('pnpm --filter malini test');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
