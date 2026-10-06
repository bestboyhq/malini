import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	git,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const UNREACHABLE = "Couldn't reach github.com. Check your connection and try again.";

test('a push without network says github.com is unreachable instead of the raw git command', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/Couldn't reach github\.com/u] });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { basePath, workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-dbg',
			'Offline workstream',
		);
		await git(basePath, ['remote', 'set-url', 'origin', 'https://github.com/e2e/hutch.git']);
		await git(basePath, ['config', 'http.proxy', 'http://127.0.0.1:9']);

		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);

		const action = page.getByRole('button', { name: 'Commit and push changes' });
		await expect(action).toBeEnabled({ timeout: 30_000 });
		await action.click();

		const failure = page.getByRole('status').filter({ hasText: 'Pull request action failed' });
		await expect(failure).toHaveText(`Pull request action failed · ${UNREACHABLE}`, {
			timeout: 30_000,
		});
		const shown = await failure.innerText();
		for (const leak of ['credential.helper', 'Some(', 'exit=', '-c ', '/var/folders', app.root]) {
			expect(shown, `the toast leaks "${leak}"`).not.toContain(leak);
		}
		await captureFlow(app, 'push-failure');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
