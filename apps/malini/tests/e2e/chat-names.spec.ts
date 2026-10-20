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

test('the first prompt names the chat and the workstream with the title Claude suggests', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'Login flow' } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-chat-names-ws', 'Bright Arc');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'hey so every time i log in the page goes blank');
		await expectAssistantReply(page);

		await expect(
			page.getByTestId('chat-agent-tabs').getByRole('tab', { name: /Login flow/u }),
		).toBeVisible({ timeout: 20_000 });
		await expect(
			page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`),
		).toContainText('Login flow');

		await captureFlow(app, 'chat-names');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
