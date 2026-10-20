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
	startFreshChat,
} from './harness';

test('a new chat offers the transcripts and plans of its workstream as context, and attaches the plan picked', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-fresh-context-ws', 'Fresh');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'CHAT_PLAN plan the endpoint');
		await expectAssistantReply(page);

		await startFreshChat(page);
		const fresh = page.getByTestId('chat-fresh-session');
		const transcript = fresh.getByTestId('chat-fresh-transcript-suggestion');
		await expect(transcript).toHaveCount(1);
		const plan = fresh.getByRole('button', { name: 'Add a health endpoint' });
		await expect(plan).toHaveAttribute('aria-pressed', 'false');
		await expect(transcript).toHaveAttribute('aria-pressed', 'false');

		await plan.click();
		await expect(plan).toHaveAttribute('aria-pressed', 'true');
		await expect(transcript).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('chat-composer-input')).toContainText(
			'Plan: Add a health endpoint',
		);
		await captureFlow(app, 'fresh-chat-context');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
