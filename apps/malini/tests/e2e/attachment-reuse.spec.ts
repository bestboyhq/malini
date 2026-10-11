import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '../../src/contract/protocol-contract.generated';
import {
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	fileExists,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
} from './harness';

const NOTES = 'notes.txt';

type Clipboard = Readonly<{ html: string; text: string }>;

function composer(page: Page): Locator {
	return page.getByTestId('chat-composer-input');
}

function notesChip(scope: Locator): Locator {
	return scope.getByLabel(`Attached file: ${NOTES}`);
}

async function pasteNotes(page: Page, into: string): Promise<void> {
	await page.evaluate(`(() => {
		const data = new DataTransfer();
		data.items.add(new File(['notes for the agent\\n'], ${JSON.stringify(NOTES)}, { type: 'text/plain' }));
		document
			.querySelector(${JSON.stringify(into)})
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	})()`);
}

async function caretAtEnd(input: Locator): Promise<void> {
	const box = await input.boundingBox();
	if (!box) throw new Error('the editor is not laid out');
	await input.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

async function copyComposer(page: Page): Promise<Clipboard> {
	await composer(page).click();
	await page.keyboard.press('ControlOrMeta+a');
	return page.evaluate<Clipboard>(`(() => {
		const data = new DataTransfer();
		document
			.querySelector('[data-testid="chat-composer-input"]')
			.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
		return { html: data.getData('text/html'), text: data.getData('text/plain') };
	})()`);
}

async function paste(page: Page, clipboard: Clipboard): Promise<void> {
	await caretAtEnd(composer(page));
	await page.evaluate(`(() => {
		const data = new DataTransfer();
		data.setData('text/html', ${JSON.stringify(clipboard.html)});
		data.setData('text/plain', ${JSON.stringify(clipboard.text)});
		document
			.querySelector('[data-testid="chat-composer-input"]')
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	})()`);
}

async function lastPrompt(page: Page): Promise<Record<string, unknown> | undefined> {
	const events = await listEvents(page, currentSessionId(page) ?? '');
	return events.filter((entry) => entry.event.type === 'user.message').at(-1)?.event;
}

function attachmentIds(prompt: Record<string, unknown> | undefined): string[] {
	const attachments = prompt?.['attachments'];
	if (!Array.isArray(attachments)) return [];
	return attachments.map((attachment) => String(Reflect.get(attachment, 'id')));
}

async function openChatWithNotes(
	app: LaunchedApp,
	workstreamId: string,
): Promise<{ worktree: string; sourceId: string; clipboard: Clipboard }> {
	const source = await createSourceRepo(app.root);
	const { worktree } = await seedWorkstream(app.page, source, workstreamId, 'Reuse workstream');
	await openWorkstream(app.page, workstreamId);
	await composer(app.page).click();
	await pasteNotes(app.page, '[data-testid="chat-composer-input"]');
	await expect(notesChip(composer(app.page))).toBeVisible({ timeout: 20_000 });
	const sourceId =
		(await notesChip(composer(app.page)).getAttribute('data-inline-attachment')) ?? '';
	return { worktree, sourceId, clipboard: await copyComposer(app.page) };
}

test('a file chip copied from one chat sends its own copy of the file from another chat', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { worktree, sourceId, clipboard } = await openChatWithNotes(app, 'e2e-reuse-ws');

		await startFreshChat(page);
		await paste(page, clipboard);
		const pasted = notesChip(composer(page));
		await expect(pasted).toBeVisible({ timeout: 20_000 });
		await expect(pasted).not.toHaveAttribute('data-inline-attachment', sourceId, {
			timeout: 20_000,
		});
		await page.keyboard.type(' Read it');
		await page.getByTestId('chat-composer-submit').click();
		await expectAssistantReply(page);

		const sent = await lastPrompt(page);
		const [copyId = ''] = attachmentIds(sent);
		expect(copyId).not.toBe(sourceId);
		expect(String(sent?.['text'])).toContain(`[[attachment:${copyId}]]`);
		expect(fileExists(join(worktree, BRIDGE_AGENT_ATTACHMENTS_PATH, copyId, NOTES))).toBe(true);
		expect(fileExists(join(worktree, BRIDGE_AGENT_ATTACHMENTS_PATH, sourceId, NOTES))).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a file chip pasted into another workstream lands in that workstream’s checkout', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { clipboard } = await openChatWithNotes(app, 'e2e-reuse-from-ws');
		const source = await createSourceRepo(app.root, 'other');
		const other = await seedWorkstream(page, source, 'e2e-reuse-to-ws', 'Other workstream');
		await openWorkstream(page, other.workstreamId);

		await paste(page, clipboard);
		await expect(notesChip(composer(page))).toBeVisible({ timeout: 20_000 });
		await page.keyboard.type(' Read it');
		await page.getByTestId('chat-composer-submit').click();
		await expectAssistantReply(page);

		const [copyId = ''] = attachmentIds(await lastPrompt(page));
		expect(fileExists(join(other.worktree, BRIDGE_AGENT_ATTACHMENTS_PATH, copyId, NOTES))).toBe(
			true,
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('editing a sent prompt shows its file as a chip and sends the file again', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openChatWithNotes(app, 'e2e-reuse-edit-ws');
		await caretAtEnd(composer(page));
		await page.keyboard.type(' Read it');
		await page.getByTestId('chat-composer-submit').click();
		await expectAssistantReply(page);
		const [firstId] = attachmentIds(await lastPrompt(page));

		await page.getByRole('button', { name: /^Edit message:/u }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message' });
		await expect(notesChip(editor)).toBeVisible({ timeout: 20_000 });
		await expect(editor).not.toContainText('[[attachment:');
		await page.keyboard.type(' twice');
		await page.getByTestId('chat-message-edit-send').click();
		await page.getByTestId('chat-message-edit-confirm-send').click();

		await expect
			.poll(async () => String((await lastPrompt(page))?.['text']), { timeout: 30_000 })
			.toContain('Read it twice');
		const [resentId] = attachmentIds(await lastPrompt(page));
		expect(resentId).toBeDefined();
		expect(resentId).not.toBe(firstId);
		await expect(page.getByTestId('chat-message-bubble-user').last()).toContainText(NOTES);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a queued prompt edits with its file chip and can take a pasted file', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-reuse-queue-ws', 'Queue workstream');
		await openWorkstream(page, 'e2e-reuse-queue-ws');
		await sendPrompt(page, 'EDIT:a.txt HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');

		await composer(page).click();
		await pasteNotes(page, '[data-testid="chat-composer-input"]');
		await expect(notesChip(composer(page))).toBeVisible({ timeout: 20_000 });
		await page.keyboard.type(' later');
		await page.keyboard.press('Enter');
		const row = page.getByTestId('prompt-queue-item');
		await expect(notesChip(row)).toBeVisible();

		await page.getByRole('button', { name: 'Edit queued prompt 1' }).click();
		const editor = page.getByRole('textbox', { name: 'Edit queued prompt' });
		await expect(notesChip(editor)).toBeVisible();
		await expect(editor).not.toContainText('[[attachment:');
		await page.keyboard.type(' please');
		await pasteNotes(page, '[data-testid="queued-prompt-editor"]');
		await expect(notesChip(editor)).toHaveCount(2, { timeout: 20_000 });
		await page.keyboard.press('ControlOrMeta+Enter');

		await expect(editor).toHaveCount(0);
		await expect(row).toContainText('later please');
		await expect(notesChip(row)).toHaveCount(2);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
