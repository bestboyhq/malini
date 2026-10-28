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

test('a turn a usage limit stops pauses calmly until the limit resets, then goes on by itself', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-limit-pause', 'Limit');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'LIMIT_PAUSE:8 Ship the fix');

		const paused = page.getByRole('status').filter({ hasText: /Paused until \d\d:\d\d/u });
		await expect(paused).toBeVisible({ timeout: 20_000 });
		await expect(paused).toContainText(
			'You hit your Claude usage limit. Malini goes on when it resets.',
		);
		await expect(paused).toContainText("You've hit your session limit · resets 3pm");
		await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
		await expect(page.getByLabel(/Workstream status: Failed/u)).toHaveCount(0);
		await captureFlow(app, 'run-recovery-usage-limit-paused');

		await expectAssistantReply(page, 60_000);
		await expect(page.getByRole('button', { name: 'Resume now' })).toHaveCount(0);
		await expect(page.getByText('Run paused', { exact: true })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Resume now goes on at once with a turn an overload paused', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-overload-pause', 'Overload');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'OVERLOADED_PAUSE Ship the fix');

		const paused = page.getByRole('status').filter({ hasText: /Paused until/u });
		await expect(paused).toContainText('Claude is overloaded. Malini tries again then.', {
			timeout: 20_000,
		});
		await paused.getByRole('button', { name: 'Resume now' }).click();

		await expectAssistantReply(page);
		await expect(page.getByRole('button', { name: 'Resume now' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a turn Claude Code is signed out for fails with Sign in and Try again, and Try again goes on', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-signed-out', 'Signed out');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'SIGNIN_FAIL Ship the fix');

		const failed = page.getByTestId('chat-run-error');
		await expect(failed).toContainText('Claude Code is not signed in', { timeout: 20_000 });
		await expect(failed.getByRole('button', { name: 'Sign in' })).toBeVisible();
		await captureFlow(app, 'run-recovery-signed-out');

		await failed.getByRole('button', { name: 'Try again' }).click();

		await expectAssistantReply(page);
		await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
