import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const FOLDER_MISSING = "This chat's workstream folder is missing, so its diffs can't be opened.";
const INSPECTOR_DID_NOT_START = /\[malini extensions\] runtime activation failed/u;

test('a chat whose workstream folder is gone keeps its change counts and says why a diff cannot open', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({
		allowedDiagnostics: [/folder is missing|folder \S+ is missing/u, INSPECTOR_DID_NOT_START],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-missing-checkout-ws',
			'Missing checkout workstream',
		);
		await openWorkstream(page, workstreamId);

		const changedFiles = page.getByRole('region', { name: /^Files changed in this chat/u });
		const toggle = changedFiles.getByTestId('chat-changed-files-toggle');
		await sendPrompt(page, 'EDIT:notes.txt');
		await expect(toggle).toContainText('1 file changed in this chat', { timeout: 30_000 });

		rmSync(worktree, { recursive: true, force: true });
		await page.reload();
		await expect(toggle).toContainText('1 file changed in this chat', { timeout: 30_000 });
		await expect(toggle).toContainText('+1');

		await toggle.click();
		await changedFiles
			.getByRole('button', { name: 'Open notes.txt agent chat diff in Files' })
			.click();
		await expect(page.getByText(FOLDER_MISSING)).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText(FOLDER_MISSING)).toBeInViewport({ ratio: 1 });
		await expect(page.getByText(/io error|Could not resolve/u)).toHaveCount(0);
		await expect(
			page.getByText("This workstream's folder is missing.", { exact: false }),
		).not.toHaveCount(0);
		await captureFlow(app, 'missing-checkout-diff');
		expect(app.pageErrors).toEqual([]);
		expect(app.consoleErrors.filter((line) => !INSPECTOR_DID_NOT_START.test(line))).toEqual([]);
	} finally {
		await app.close();
	}
});
