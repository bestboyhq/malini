import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('boot, seed a workstream, send a prompt, and see the reply', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await expect(page).toHaveTitle('malini · Repositories');

		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-smoke-ws', 'Smoke workstream');
		await openWorkstream(page, seeded.workstreamId);

		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		await expect(page.getByTestId('run-activity-file')).toBeVisible();

		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat did not commit a session id to the URL');
		const events = await listEvents(page, sessionId);
		expect(events.some((entry) => entry.event.type === 'run.completed')).toBe(true);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
