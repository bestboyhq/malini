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
	type LaunchedApp,
} from './harness';

const NOTES = 'notes.txt';

async function openSeededWorkstream(app: LaunchedApp, workstreamId: string): Promise<string> {
	const source = await createSourceRepo(app.root);
	const seeded = await seedWorkstream(app.page, source, workstreamId, 'Attachments workstream');
	await openWorkstream(app.page, seeded.workstreamId);
	return seeded.worktree;
}

function composer(page: Page): Locator {
	return page.getByTestId('chat-composer-input');
}

async function pasteNotes(
	page: Page,
	worktree: string,
): Promise<{ chip: Locator; staged: string }> {
	const input = composer(page);
	await input.click();
	await page.evaluate(`(() => {
		const data = new DataTransfer();
		data.items.add(new File(['notes for the agent\\n'], ${JSON.stringify(NOTES)}, { type: 'text/plain' }));
		document
			.querySelector('[data-testid="chat-composer-input"]')
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	})()`);
	const chip = input.getByLabel(`Attached file: ${NOTES}`);
	await expect(chip).toBeVisible({ timeout: 20_000 });
	const stagedId = await chip.getAttribute('data-inline-attachment');
	return { chip, staged: join(worktree, BRIDGE_AGENT_ATTACHMENTS_PATH, stagedId ?? '') };
}

async function sentPrompt(page: Page): Promise<Record<string, unknown> | undefined> {
	await expect.poll(() => currentSessionId(page), { timeout: 30_000 }).not.toBeNull();
	const events = await listEvents(page, currentSessionId(page) ?? '');
	return events.filter((entry) => entry.event.type === 'user.message').at(-1)?.event;
}

test('clicking a file chip puts the caret after it, so typing there keeps the file attached', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const worktree = await openSeededWorkstream(app, 'e2e-chip-click-ws');
		const { chip } = await pasteNotes(page, worktree);

		await chip.click();
		await page.keyboard.type(' Read the notes');
		await expect(chip).toBeVisible();
		await page.getByTestId('chat-composer-submit').click();
		await expectAssistantReply(page);

		const prompt = await sentPrompt(page);
		expect(String(prompt?.['text'])).toMatch(/^\[\[attachment:att-[0-9a-f]+\]\]\s+Read the notes/u);
		expect(prompt?.['attachments']).toEqual([
			expect.objectContaining({ displayName: NOTES, mediaType: 'text/plain' }),
		]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a file chip removed with Backspace and brought back with undo still sends its file', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const worktree = await openSeededWorkstream(app, 'e2e-chip-undo-ws');
		const { chip, staged } = await pasteNotes(page, worktree);

		await chip.click();
		await page.keyboard.press('Backspace');
		await expect(chip).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(chip).toBeVisible();
		expect(fileExists(staged)).toBe(true);

		await sendPrompt(page, 'Read the notes');
		await expectAssistantReply(page);
		const prompt = await sentPrompt(page);
		expect(prompt?.['attachments']).toEqual([
			expect.objectContaining({ displayName: NOTES, mediaType: 'text/plain' }),
		]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a removed file chip stays gone, and its file is released once the prompt is sent', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const worktree = await openSeededWorkstream(app, 'e2e-chip-remove-ws');
		const { chip, staged } = await pasteNotes(page, worktree);

		await chip.hover();
		await composer(page).getByTestId('chat-composer-chip-remove').click();
		await expect(composer(page).locator('[data-prompt-chip]')).toHaveCount(0);
		await page.waitForTimeout(500);
		await expect(composer(page).locator('[data-prompt-chip]')).toHaveCount(0);
		expect(fileExists(staged)).toBe(true);

		await sendPrompt(page, 'Start over');
		await expectAssistantReply(page);
		const prompt = await sentPrompt(page);
		expect(prompt?.['text']).toBe('Start over');
		expect(prompt?.['attachments'] ?? []).toEqual([]);
		await expect.poll(() => fileExists(staged), { timeout: 10_000 }).toBe(false);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('closing a chat releases the files its draft still held', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const worktree = await openSeededWorkstream(app, 'e2e-chip-close-ws');
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		const { staged } = await pasteNotes(page, worktree);

		await page.getByRole('tab', { name: /Explain the login flow/u }).hover();
		await page.getByRole('button', { name: 'Close Explain the login flow' }).click();
		await expect(page.getByRole('tab', { name: /Explain the login flow/u })).toHaveCount(0, {
			timeout: 20_000,
		});

		await expect.poll(() => fileExists(staged), { timeout: 10_000 }).toBe(false);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
