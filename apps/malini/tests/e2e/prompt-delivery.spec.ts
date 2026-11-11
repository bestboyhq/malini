import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
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
	listSessions,
	openWorkstream,
	seedTwoChats,
	seedWorkstream,
	selectChat,
	sendPrompt,
	type LaunchedApp,
} from './harness';

test('a queued prompt sent ahead interrupts the running reply, and the rest of the queue runs after it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-queue-ahead-ws');

		await startHangingRun(page);
		await queuePrompt(page, 'First queued');
		await queuePrompt(page, 'Second queued');
		await expect(page.getByTestId('prompt-queue-item')).toHaveCount(2);

		await page.getByRole('button', { name: 'Interrupt and send queued prompt 2' }).click();

		await expect
			.poll(() => userMessages(page, sessionId), { timeout: 30_000 })
			.toEqual(['EDIT:a.txt', 'HANG', 'Second queued', 'First queued']);
		await expect(page.getByTestId('prompt-queue')).toBeHidden();
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt', {
			timeout: 20_000,
		});
		await captureFlow(app, 'prompt-queue-send-ahead');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('⌘↵ sends a prompt ahead of one still waiting for the last turn to finish saving its changes', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-steer-waiting-ws');
		const releaseSnapshots = await finishTurnWithHeldSnapshot(app, 'EDIT:c.txt');
		await expect
			.poll(async () =>
				(await listEvents(page, sessionId)).filter(({ event }) => event.type === 'run.completed'),
			)
			.toHaveLength(2);
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt');
		await sendPrompt(page, 'Waiting for the chat');
		await expect(page.getByTestId('chat-composer-input')).toHaveText('');
		await page.waitForTimeout(1_000);
		expect(await userMessages(page, sessionId)).toEqual(['EDIT:a.txt', 'EDIT:c.txt']);

		await page.getByTestId('chat-composer-input').click();
		await page.keyboard.type('Steer now', { delay: 10 });
		await page.keyboard.press('Meta+Enter');
		await expect(page.getByTestId('chat-composer-input')).toHaveText('');
		releaseSnapshots();

		await expect
			.poll(() => userMessages(page, sessionId), { timeout: 30_000 })
			.toEqual(['EDIT:a.txt', 'EDIT:c.txt', 'Steer now', 'Waiting for the chat']);
		await expect(page.getByTestId('prompt-queue')).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt sent ahead of a turn that keeps saving its changes runs once the save ends', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-steer-stalled-ws');
		const releaseSnapshots = await finishTurnWithHeldSnapshot(app, 'EDIT:c.txt');
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt', {
			timeout: 20_000,
		});

		await page.getByTestId('chat-composer-input').click();
		await page.keyboard.type('Steer now', { delay: 10 });
		await page.keyboard.press('Meta+Enter');
		await expect(page.getByTestId('chat-composer-input')).toHaveText('');
		await page.waitForTimeout(30_000);
		await expect(page.getByTestId('prompt-queue-item')).toHaveCount(0);
		expect(await userMessages(page, sessionId)).toEqual(['EDIT:a.txt', 'EDIT:c.txt']);

		releaseSnapshots();
		await expect
			.poll(() => userMessages(page, sessionId), { timeout: 30_000 })
			.toEqual(['EDIT:a.txt', 'EDIT:c.txt', 'Steer now']);
		await expect(page.getByTestId('prompt-queue')).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt sent ahead of a reply that keeps running says it waits, then runs once the reply ends', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { chatA, chatB } = await seedTwoChats(page, source, 'e2e-queue-note-ws', 'Queue note');
		await startHangingRun(page);
		await selectChat(page, chatA);
		const releaseSnapshots = await finishTurnWithHeldSnapshot(app, 'EDIT:c.txt');
		await expect
			.poll(async () =>
				(await listEvents(page, chatA)).filter(({ event }) => event.type === 'run.completed'),
			)
			.toHaveLength(2);

		await selectChat(page, chatB);
		await queuePrompt(page, 'Send ahead');
		await page.getByRole('button', { name: 'Interrupt and send queued prompt 1' }).click();
		const queued = page.getByTestId('prompt-queue-item').filter({ hasText: 'Send ahead' });
		await expect(queued.getByRole('status')).toHaveText(
			'The interrupted reply is still running. This prompt waits for it to end.',
			{ timeout: 60_000 },
		);
		await expect(queued.getByRole('alert')).toHaveCount(0);
		await captureFlow(app, 'prompt-queue-waiting-note');

		releaseSnapshots();
		await page.getByRole('button', { name: 'Stop current run' }).click();
		await expect
			.poll(() => userMessages(page, chatB), { timeout: 30_000 })
			.toEqual(['EDIT:b.txt', 'HANG', 'Send ahead']);
		await expect(page.getByTestId('prompt-queue')).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a queued prompt waits while it is being edited, and runs once the edit ends', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-queue-edit-ws');

		await startHangingRun(page);
		await queuePrompt(page, 'Held while edited');
		await page.getByRole('button', { name: 'Edit queued prompt 1' }).click();
		await expect(page.getByTestId('prompt-queue')).toContainText('Paused while editing');

		const submit = page.getByTestId('chat-composer-submit');
		await submit.click();
		await expect(submit).toHaveAccessibleName('Send prompt', { timeout: 20_000 });
		await page.waitForTimeout(2_000);
		expect(await userMessages(page, sessionId)).toEqual(['EDIT:a.txt', 'HANG']);

		await page.getByRole('button', { name: 'Cancel queued prompt edit' }).click();

		await expect
			.poll(() => userMessages(page, sessionId), { timeout: 30_000 })
			.toEqual(['EDIT:a.txt', 'HANG', 'Held while edited']);
		await expect(page.getByTestId('prompt-queue')).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt the agent refuses goes back into the composer, and a refused queued prompt stays queued with the reason', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/the agent refused this/u] });
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-refused-ws');
		const input = page.getByTestId('chat-composer-input');

		await sendPrompt(page, 'REFUSED_PROMPT now');
		await expect(input).toHaveText('REFUSED_PROMPT now', { timeout: 20_000 });
		await expect(
			page.getByText('Prompt could not be sent. Its complete draft was restored.'),
		).toBeVisible();
		await captureFlow(app, 'prompt-refused-restored');

		await input.click();
		await page.keyboard.press('Meta+A');
		await page.keyboard.press('Backspace');
		await expect(input).toHaveText('');
		await startHangingRun(page);
		await queuePrompt(page, 'REFUSED_PROMPT later');
		await page.getByTestId('chat-composer-submit').click();

		const queued = page.getByTestId('prompt-queue-item');
		await expect(queued.getByTestId('queued-prompt-error')).toContainText(
			'the agent refused this',
			{ timeout: 30_000 },
		);
		await expect(queued).toContainText('REFUSED_PROMPT later');
		await captureFlow(app, 'prompt-refused-queued');

		await page.getByRole('button', { name: 'Delete queued prompt 1' }).click();
		await expect(page.getByTestId('prompt-queue')).toBeHidden();
		await captureFlow(app, 'prompt-refused-after');
		expect(sessionId).not.toBe('');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('picking another model mid-chat sends the next prompt to a new chat, and other workstreams start with it', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-model-switch-ws');
		const picker = page.getByRole('button', { name: /^Model: / });
		const models = page.getByRole('listbox', { name: 'Models' });

		await picker.click();
		await models.getByRole('option', { name: /^Opus/u }).click();
		await sendPrompt(page, 'EDIT:b.txt');
		await expect.poll(() => userMessages(page, sessionId), { timeout: 20_000 }).toHaveLength(2);
		expect(currentSessionId(page)).toBe(sessionId);

		await picker.click();
		await models.getByRole('option', { name: /^Sonnet/u }).click();
		await expect(picker).toHaveAccessibleName('Model: Sonnet 5.5');
		await sendPrompt(page, 'EDIT:c.txt');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(sessionId);
		const fresh = currentSessionId(page) ?? '';
		await expect.poll(() => userMessages(page, fresh), { timeout: 20_000 }).toEqual(['EDIT:c.txt']);
		const sessions = await listSessions(page, 'e2e-model-switch-ws');
		expect(sessions.find((session) => session.id === fresh)?.model).toMatch(/sonnet/u);
		expect(await userMessages(page, sessionId)).toEqual(['EDIT:a.txt', 'EDIT:b.txt']);

		const other = await createSourceRepo(app.root, 'other');
		await seedWorkstream(page, other, 'e2e-model-other-ws', 'Other workstream');
		await openWorkstream(page, 'e2e-model-other-ws');
		await expect(picker).toHaveAccessibleName('Model: Sonnet 5.5', { timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function chatWithOneReply(app: LaunchedApp, workstreamId: string): Promise<string> {
	const source = await createSourceRepo(app.root);
	await seedWorkstream(app.page, source, workstreamId, 'Delivery workstream');
	await openWorkstream(app.page, workstreamId);
	await sendPrompt(app.page, 'EDIT:a.txt');
	await expectAssistantReply(app.page);
	const sessionId = currentSessionId(app.page);
	if (!sessionId) throw new Error('the chat did not commit a session id');
	return sessionId;
}

async function startHangingRun(page: Page): Promise<void> {
	await sendPrompt(page, 'HANG');
	await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Stop current run', {
		timeout: 20_000,
	});
}

async function queuePrompt(page: Page, text: string): Promise<void> {
	const submit = page.getByTestId('chat-composer-submit');
	await page.getByTestId('chat-composer-input').click();
	await page.keyboard.type(text, { delay: 10 });
	await expect(submit).toHaveAccessibleName('Queue prompt');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('prompt-queue-item').filter({ hasText: text })).toBeVisible();
	await expect(submit).toHaveAccessibleName('Stop current run');
}

async function userMessages(page: Page, sessionId: string): Promise<string[]> {
	return (await listEvents(page, sessionId)).flatMap(({ event }) =>
		event.type === 'user.message' ? [String(event['text'])] : [],
	);
}

async function finishTurnWithHeldSnapshot(app: LaunchedApp, prompt: string): Promise<() => void> {
	const heldRuns = join(app.home, 'hold-agent-runs');
	writeFileSync(heldRuns, '');
	await sendPrompt(app.page, prompt);
	await expect(app.page.getByTestId('chat-composer-submit')).toHaveAccessibleName(
		'Stop current run',
	);
	const releaseSnapshots = holdRunSnapshots(app);
	rmSync(heldRuns);
	return releaseSnapshots;
}

function holdRunSnapshots(app: LaunchedApp): () => void {
	const gate = join(app.root, 'hold-run-snapshots');
	const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
	const stub = join(app.bin, 'git');
	writeFileSync(gate, '');
	writeFileSync(
		stub,
		`#!/bin/sh
case "$*" in *commit-tree*"malini run snapshot"*) while [ -e '${gate}' ]; do sleep 0.05; done ;; esac
exec '${realGit}' "$@"
`,
	);
	chmodSync(stub, 0o755);
	return () => rmSync(gate, { force: true });
}
