import { existsSync, rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const INSPECTOR_DID_NOT_START = /\[malini extensions\] runtime activation failed/u;

test('a chat whose workstream folder is gone keeps its change counts, and the folder comes back to open its diff', async () => {
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
