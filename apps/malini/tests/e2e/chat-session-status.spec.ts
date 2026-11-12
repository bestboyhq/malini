import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { sidebarStatus } from './fake-github';
import {
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

async function reloadChat(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
}

test('a chat you answered still shows it runs after a reload', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-answered-ws',
			'Answered workstream',
		);
		await openWorkstream(page, workstreamId);
		const status = sidebarStatus(page, workstreamId);
		const release = join(app.home, 'release-approval');

		await sendPrompt(page, 'APPROVAL_HOLD');
		const decision = page.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });
		await expect(status).toHaveAccessibleName('Workstream status: Approval');
		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		await reloadChat(page);
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		writeFileSync(release, '');
		await expect(status).toHaveAccessibleName('Workstream status: Ready', { timeout: 20_000 });

		rmSync(release);
		await sendPrompt(page, 'QUESTION_HOLD');
		await expect(page.getByRole('radiogroup', { name: 'Which?' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(status).toHaveAccessibleName('Workstream status: Approval');
		await page.keyboard.press('2');
		await page.getByRole('button', { name: 'Send answer' }).click();
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		await reloadChat(page);
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		await expect(page.getByTestId('agent-question-panel')).toHaveCount(0);
		writeFileSync(release, '');
		await expect(status).toHaveAccessibleName('Workstream status: Ready', { timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat you stopped does not show as failed from another workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-stopped-ws',
			'Stopped workstream',
		);
		const other = await seedWorkstream(page, source, 'e2e-elsewhere-ws', 'Elsewhere workstream');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'EDIT:b.txt HANG');
		await expect(page.getByTestId('run-activity-file').filter({ hasText: 'b.txt' })).toBeVisible({
			timeout: 20_000,
		});
		const submit = page.getByTestId('chat-composer-submit');
		await submit.click();
		await expect(submit).toHaveAccessibleName('Send prompt', { timeout: 15_000 });

		await openWorkstream(page, other.workstreamId);
		await expect
			.poll(async () =>
				(await invoke<{ status: string }[]>(page, 'chat.list-sessions', { workstreamId })).map(
					({ status }) => status,
				),
			)
			.toEqual(['idle']);
		await expect(sidebarStatus(page, workstreamId)).toBeVisible();
		await expect(sidebarStatus(page, workstreamId)).not.toHaveAccessibleName(/Failed/u);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a request Claude Code withdraws stops the chat waiting for you', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-withdrawn-ws',
			'Withdrawn workstream',
		);
		await openWorkstream(page, workstreamId);
		const status = sidebarStatus(page, workstreamId);
		const runStatus = page.getByTestId('run-status-slot');
		const release = join(app.home, 'release-approval');

		await sendPrompt(page, 'APPROVAL_WITHDRAWN');
		await expect(page.getByRole('group', { name: 'Permission decision' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(status).toHaveAccessibleName('Workstream status: Approval');
		await expect(runStatus).toContainText('Waiting for you');

		writeFileSync(release, '');
		await expect(page.getByText('No longer active')).toBeVisible({ timeout: 20_000 });
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		await expect(runStatus).not.toContainText('Waiting for you');
		await reloadChat(page);
		await expect(status).toHaveAccessibleName('Workstream status: Running');
		await expect(page.getByText('No longer active')).toBeVisible();
		await expect(runStatus).not.toContainText('Waiting for you');

		rmSync(release);
		await expect(status).toHaveAccessibleName('Workstream status: Ready', { timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('allowing a call the run already left behind says it is no longer active', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-left-ws', 'Left workstream');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'APPROVAL_ENDS');
		const decision = page.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });
		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(page.getByText('No longer active')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText(/INTERACTION_RUN_NOT_ACTIVE/u)).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
