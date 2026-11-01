import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedTwoChats,
	selectChat,
	sendPrompt,
	visibleRunIds,
} from './harness';

test('editing a prompt resends it, appends a run, and keeps the old run under the toggle', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, chatA } = await seedTwoChats(
			page,
			source,
			'e2e-edit-ws',
			'Edit workstream',
		);

		await openWorkstream(page, workstreamId, chatA);
		await page.getByRole('button', { name: 'Edit message: EDIT:a.txt' }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message' });
		await expect(editor).toBeVisible({ timeout: 20_000 });
		await editor.fill('EDIT:a-v2.txt');
		await page.keyboard.press('Shift+Enter');
		await expect.poll(() => editor.innerText()).toMatch(/^EDIT:a-v2\.txt\n/u);
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Enter');
		await page.getByTestId('chat-message-edit-confirm-send').click();

		await expectAssistantReply(page, 30_000);
		await expect(page.getByTestId('chat-message-bubble-user')).toContainText('EDIT:a-v2.txt');

		const runsAfterResend = await visibleRunIds(page);
		expect(runsAfterResend).toHaveLength(1);

		const toggle = page.getByTestId('chat-show-undone-toggle');
		await expect(toggle).toBeVisible({ timeout: 20_000 });
		await toggle.click();
		await expect.poll(() => visibleRunIds(page)).toHaveLength(2);
		await expect(
			page.getByTestId('chat-message-list').getByText('EDIT:a.txt', { exact: true }),
		).toBeVisible();

		const eventsA = await listEvents(page, chatA);
		expect(eventsA.some((entry) => entry.event.type === 'turn.superseded')).toBe(true);
		expect(eventsA.some((entry) => entry.event.type === 'run.completed')).toBe(true);

		await captureFlow(app, 'flow-2-edit-resend');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat cannot be rewound while another chat of its workstream runs, and warns what a rewind discards', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { chatA, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-rewind-guard-ws',
			'Rewind guard workstream',
		);
		await sendPrompt(page, 'HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');

		await selectChat(page, chatA);
		const undo = page.getByTestId('chat-run-undo-arm');
		await expect(undo).toBeDisabled({ timeout: 20_000 });
		await page.getByRole('button', { name: 'Edit message: EDIT:a.txt' }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message' });
		await editor.fill('EDIT:a-v2.txt');
		await expect(page.getByTestId('chat-message-edit-send')).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(editor).toHaveCount(0);

		await selectChat(page, chatB);
		await submit.click();
		await expect(submit).toHaveAccessibleName('Send prompt', { timeout: 15_000 });
		await selectChat(page, chatA);
		await expect(undo).toBeEnabled({ timeout: 20_000 });
		await page.getByRole('button', { name: 'Edit message: EDIT:a.txt' }).click();
		await editor.fill('EDIT:a-v2.txt');
		await page.getByTestId('chat-message-edit-send').click();
		await expect(
			page.getByText('Discards 1 file change made since this message, and every reply after it.'),
		).toBeVisible();
		await expect(page.getByTestId('chat-message-edit-confirm-send')).toBeVisible();
		await captureFlow(app, 'rewind-guard-warning');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
