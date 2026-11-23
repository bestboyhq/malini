import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	REAL_GIT,
	seedWorkstream,
	sendPrompt,
	writeExecutable,
	type LaunchedApp,
	type MaliniEvent,
} from './harness';

test('the context picker lists the workstream files, picks up a file the agent creates, and sends the picked file with the prompt', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-context-ws', 'Context');
		await openWorkstream(page, workstreamId);

		const results = page.getByTestId('chat-context-result');
		await openPicker(page);
		await expect(results.and(page.locator('[data-context-path="seed.txt"]'))).toBeVisible({
			timeout: 20_000,
		});
		await expect(results.and(page.locator('[data-context-path="fresh.txt"]'))).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.keyboard.press('Backspace');
		await expect(page.getByTestId('chat-composer-input')).toHaveText('');

		await sendPrompt(page, 'EDIT:fresh.txt');
		await expectAssistantReply(page);

		await openPicker(page);
		const fresh = results.and(page.locator('[data-context-path="fresh.txt"]'));
		await expect(fresh).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'context-picker-fresh-file');
		await fresh.click();
		await sendPrompt(page, 'Use it');

		await expect
			.poll(async () => (await lastUserMessage(page))?.['contextFiles'], { timeout: 20_000 })
			.toEqual(['fresh.txt']);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('@todos sends the workstream todo list with the prompt', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-todos-ws', 'Todos');
		const releaseGitStatus = holdGitStatus(app);
		await openWorkstream(page, workstreamId);

		await openPicker(page);
		await page.getByTestId('chat-context-todos').click();
		await expect(page.getByTestId('chat-composer-input')).toContainText('@todos');
		await page.keyboard.type('Work through ', { delay: 10 });
		await page.getByTestId('chat-composer-submit').click();
		releaseGitStatus();
		await expectAssistantReply(page);

		const text = String((await lastUserMessage(page))?.['text'] ?? '');
		expect(text).toContain('@todos');
		expect(text).toContain('[BEGIN UNTRUSTED WORKSTREAM TODOS]');
		expect(text).toContain('No todos are currently recorded for this workstream.');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('leaving a workstream while its @todos load frees the composer and keeps the prompt', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const left = await seedWorkstream(page, source, 'e2e-todos-left', 'Left');
		const other = await seedWorkstream(page, source, 'e2e-todos-other', 'Other');
		const releaseGitStatus = holdGitStatus(app);
		await openWorkstream(page, left.workstreamId);

		const input = page.getByTestId('chat-composer-input');
		await openPicker(page);
		await page.getByTestId('chat-context-todos').click();
		await page.keyboard.type('Work through ', { delay: 10 });
		await page.getByTestId('chat-composer-submit').click();
		await expect(input).toHaveAttribute('aria-disabled', 'true');

		await workstreamLink(page, other.workstreamId).click();
		await expect(input).toHaveAttribute('aria-disabled', 'false', { timeout: 5_000 });
		releaseGitStatus();

		await workstreamLink(page, left.workstreamId).click();
		await expect(input).toContainText('@todos');
		await expect(input).toContainText('Work through');
		await expect(page.getByTestId('chat-message-bubble')).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function workstreamLink(page: Page, workstreamId: string) {
	return page.locator(`a[data-navigation-workstream-id="${workstreamId}"]`).first();
}

function holdGitStatus(app: LaunchedApp): () => void {
	const gate = join(app.root, 'git-status-held');
	writeExecutable(
		join(app.bin, 'git'),
		[
			'#!/bin/sh',
			`case " $* " in *" status --porcelain "*) while [ -e '${gate}' ]; do sleep 0.05; done ;; esac`,
			`exec '${REAL_GIT}' "$@"`,
			'',
		].join('\n'),
	);
	writeFileSync(gate, '');
	return () => rmSync(gate, { force: true });
}

async function openPicker(page: Page): Promise<void> {
	await page.getByTestId('chat-composer-input').click();
	await page.keyboard.press('@');
	await expect(page.getByRole('dialog', { name: 'Add workstream context' })).toBeVisible();
}

async function lastUserMessage(page: Page): Promise<MaliniEvent['event'] | undefined> {
	const sessionId = currentSessionId(page);
	if (!sessionId) return undefined;
	return (await listEvents(page, sessionId))
		.filter(({ event }) => event.type === 'user.message')
		.at(-1)?.event;
}
