import { existsSync, rmSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	launchMalini,
	moveFoldersMaliniHolds,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const INSPECTOR_DID_NOT_START = /\[malini extensions\] runtime activation failed/u;

function changedFiles(page: Page): Locator {
	return page.getByRole('region', { name: /^Files changed in this chat/u });
}

function changedFilesToggle(page: Page): Locator {
	return changedFiles(page).getByTestId('chat-changed-files-toggle');
}

test('a chat whose workstream folder is gone keeps its change counts, and the folder comes back to open its diff', async () => {
	test.setTimeout(180_000);
	const options = {
		allowedDiagnostics: [/folder is missing|folder \S+ is missing/u, INSPECTOR_DID_NOT_START],
	};
	let app = await launchMalini(options);
	try {
		let { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-missing-checkout-ws',
			'Missing checkout workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'EDIT:notes.txt');
		await expect(changedFilesToggle(page)).toContainText('1 file changed in this chat', {
			timeout: 30_000,
		});

		app = await moveFoldersMaliniHolds(app, options, workstreamId, () =>
			rmSync(worktree, { recursive: true, force: true }),
		);
		({ page } = app);
		await page.reload();
		const toggle = changedFilesToggle(page);
		await expect(toggle).toContainText('1 file changed in this chat', { timeout: 30_000 });
		await expect(toggle).toContainText('+1');

		await toggle.click();
		await changedFiles(page)
			.getByRole('button', { name: 'Open notes.txt agent chat diff in Files' })
			.click();
		await expect(page.getByRole('table', { name: 'Unified diff for notes.txt' })).toBeVisible({
			timeout: 20_000,
		});
		expect(existsSync(worktree)).toBe(true);
		await expect(page.getByText(/io error|Could not resolve/u)).toHaveCount(0);
		await expect(page.getByRole('status', { name: /^Needs you/u })).toHaveCount(0);
		await expect(page.getByTestId('chat-checkout-wait')).toBeHidden();
		await captureFlow(app, 'missing-checkout-diff');
		expect(app.pageErrors).toEqual([]);
		expect(app.consoleErrors.filter((line) => !INSPECTOR_DID_NOT_START.test(line))).toEqual([]);
	} finally {
		await app.close();
	}
});
