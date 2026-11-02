import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
} from './harness';

test('the model picker is one button that opens and closes its list from the keyboard', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-model-picker-ws',
			'Model picker workstream',
		);
		await openWorkstream(page, workstreamId);

		const picker = page.getByRole('button', { name: /^Model: / });
		await expect(picker).toHaveCount(1, { timeout: 20_000 });
		await app.electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.setSize(900, 700),
		);
		await expect(picker).toHaveAccessibleName('Model: Opus');
		const models = page.getByRole('listbox', { name: 'Models' });

		await picker.focus();
		await page.keyboard.press('Enter');
		await expect(models).toBeVisible();
		await expect(picker).toHaveAttribute('aria-expanded', 'true');
		await expect(models.getByRole('option', { name: /^Opus/u })).toHaveAttribute(
			'aria-selected',
			'true',
		);

		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();
		await expect(page.getByTestId('chat-composer-input')).toBeFocused();
		await expect(picker).toHaveAttribute('aria-expanded', 'false');

		await picker.focus();
		await page.keyboard.press('Space');
		await expect(models).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('every chat keeps its own model and effort, and a new chat starts with the ones you picked last', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-chat-setup-ws', 'Chat setup');
		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: /^Model: / });
		const effort = page.getByRole('button', { name: 'Reasoning effort' });

		await pickEffort(page, 'Max');
		const opusChat = await chatAbout(page, 'EDIT:a.txt');

		await startFreshChat(page);
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('Max');
		await pickModel(page, 'Sonnet');
		await pickEffort(page, 'Low');
		const sonnetChat = await chatAbout(page, 'EDIT:b.txt');
		expect(sonnetChat).not.toBe(opusChat);

		await showChat(page, opusChat);
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('Max');
		await pickEffort(page, 'High');

		await showChat(page, sonnetChat);
		await expect(picker).toHaveAccessibleName('Model: Sonnet');
		await expect(effort).toHaveText('Low');

		await startFreshChat(page);
		const freshChat = currentSessionId(page) ?? '';
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('High');

		await showChat(page, opusChat);
		await expect(effort).toHaveText('High');
		await showChat(page, sonnetChat);
		await expect(effort).toHaveText('Low');
		await showChat(page, freshChat);
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('High');

		await openWorkstream(page, workstreamId, sonnetChat);
		await expect(picker).toHaveAccessibleName('Model: Sonnet', { timeout: 20_000 });
		await expect(effort).toHaveText('Low');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a preset saves a model with its effort, and picking it sets both until you remove it', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-model-presets-ws', 'Presets');
		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: /^Model: / });
		const effort = page.getByRole('button', { name: 'Reasoning effort' });
		const models = page.getByRole('listbox', { name: 'Models' });
		const opusMax = models
			.getByRole('group', { name: 'Presets' })
			.getByRole('option', { name: 'Opus · Max' });

		await pickEffort(page, 'Max');
		await picker.click();
		await expect(models.getByRole('group', { name: 'Presets' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Save Opus · Max as a preset' }).click();
		await expect(opusMax).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('button', { name: 'Remove Opus · Max preset' })).toBeVisible();
		await page.keyboard.press('Escape');

		await pickModel(page, 'Sonnet');
		await pickEffort(page, 'Low');
		await picker.click();
		await expect(opusMax).toHaveAttribute('aria-selected', 'false');
		await captureFlow(app, 'model-presets-menu');
		await opusMax.click();
		await expect(models).toBeHidden();
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('Max');

		await startFreshChat(page);
		await expect(picker).toHaveAccessibleName('Model: Opus');
		await expect(effort).toHaveText('Max');

		await openWorkstream(page, workstreamId);
		await picker.click();
		await expect(opusMax).toHaveAttribute('aria-selected', 'true');
		await page.getByRole('button', { name: 'Remove Opus · Max preset' }).click();
		await expect(models.getByRole('group', { name: 'Presets' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Save Opus · Max as a preset' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function chatAbout(page: Page, prompt: string): Promise<string> {
	const before = currentSessionId(page);
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBeNull();
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(before);
	return currentSessionId(page) ?? '';
}

async function showChat(page: Page, sessionId: string): Promise<void> {
	await page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`).click();
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(sessionId);
}

async function pickModel(page: Page, label: string): Promise<void> {
	await page.getByRole('button', { name: /^Model: / }).click();
	await page
		.getByRole('listbox', { name: 'Models' })
		.getByRole('group', { name: 'Models' })
		.getByRole('option', { name: new RegExp(`^${label}`, 'u') })
		.click();
	await expect(page.getByRole('button', { name: /^Model: / })).toHaveAccessibleName(
		`Model: ${label}`,
	);
}

async function pickEffort(page: Page, label: string): Promise<void> {
	const effort = page.getByRole('button', { name: 'Reasoning effort' });
	await effort.click();
	await page
		.getByRole('listbox', { name: 'Reasoning effort levels' })
		.getByRole('option', { name: label, exact: true })
		.click();
	await expect(effort).toHaveText(label);
}
