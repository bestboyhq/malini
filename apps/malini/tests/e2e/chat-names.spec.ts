import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a chat and its workstream keep their placeholders until a turn has a task, then take the name from the reply', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'none' } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-chat-names-ws',
			'New workstream',
		);
		await openWorkstream(page, workstreamId);
		const tabs = page.getByTestId('chat-agent-tabs');
		const row = page.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
		);

		await sendPrompt(page, 'hi');
		await expectAssistantReply(page);
		await expect(tabs.getByRole('tab', { name: 'New chat' })).toBeVisible();
		await expect(row).toContainText('New workstream');

		await sendPrompt(
			page,
			'every time i log in the page goes blank TITLE="Login flow" REPLY_TITLE="Blank login page"',
		);
		const namedTab = tabs.getByRole('tab', { name: 'Blank login page' });
		await expect(namedTab).toBeVisible({ timeout: 20_000 });
		await expect(row).toContainText('Blank login page');
		await expect(row).not.toContainText('New workstream');

		await captureFlow(app, 'chat-names');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
