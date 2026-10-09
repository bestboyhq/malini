import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '../../src/contract/protocol-contract.generated';
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
	seedWorkstream,
	sendPrompt,
} from './harness';

function conversation(
	events: Awaited<ReturnType<typeof listEvents>>,
): Awaited<ReturnType<typeof listEvents>> {
	return events.filter((entry) => entry.event.type !== 'session.state');
}

test('forking a run opens a new chat with its transcript attached and leaves the chat as it was', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-fork-ws',
			'Fork workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		const parent = currentSessionId(page);
		if (!parent) throw new Error('the first chat did not commit a session id');
		const parentName = (await listSessions(page, workstreamId)).find(
			(session) => session.id === parent,
		)?.displayName;
		const transcriptName = `Transcript of ${parentName}.md`;
		const parentEvents = conversation(await listEvents(page, parent));

		const fork = page.getByRole('button', { name: 'Fork to new chat' });
		await fork.hover();
		await captureFlow(app, 'flow-4-fork-source');
		await fork.click();

		await expect(page.getByRole('tab', { name: 'New chat', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(parent);
		const forked = currentSessionId(page);
		expect(forked).not.toBeNull();
		const composer = page.getByTestId('chat-composer-input');
		await expect(composer.getByLabel(`Attached file: ${transcriptName}`)).toBeVisible();
		await expect(composer).toBeFocused();
		await expect(page.getByTestId('toast')).toHaveCount(0);
		expect(conversation(await listEvents(page, parent))).toEqual(parentEvents);
		expect(
			(await listEvents(page, forked ?? '')).filter((entry) => entry.event.type === 'user.message'),
		).toEqual([]);
		await captureFlow(app, 'flow-4-fork-new-chat');

		await sendPrompt(page, 'Carry on from the transcript');
		await expectAssistantReply(page);
		expect(currentSessionId(page)).toBe(forked);
		await expect(composer.getByLabel(`Attached file: ${transcriptName}`)).toHaveCount(0);
		await captureFlow(app, 'flow-4-fork-sent');
		const prompt = (await listEvents(page, forked ?? '')).find(
			(entry) => entry.event.type === 'user.message',
		)?.event;
		expect(prompt?.['text']).toContain('Carry on from the transcript');
		expect(prompt?.['attachments']).toEqual([
			expect.objectContaining({ displayName: transcriptName, mediaType: 'text/plain' }),
		]);
		const staging = join(worktree, BRIDGE_AGENT_ATTACHMENTS_PATH);
		const [staged] = readdirSync(staging);
		expect(readFileSync(join(staging, staged ?? '', transcriptName), 'utf8')).toBe(
			[
				`# Transcript of ${parentName}`,
				'## User',
				'Explain the login flow',
				'## Assistant',
				'Hello from the fake bridge',
				'[Result: done]',
			].join('\n\n') + '\n',
		);
		expect(conversation(await listEvents(page, parent))).toEqual(parentEvents);
		const forkedName = 'Carry on from the transcript';
		expect(
			(await listSessions(page, workstreamId)).find((session) => session.id === forked)
				?.displayName,
		).toBe(forkedName);

		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		const nested = composer.getByLabel(`Attached file: Transcript of ${forkedName}.md`);
		await expect(nested).toBeVisible({ timeout: 20_000 });
		const nestedId = await nested.getAttribute('data-inline-attachment');
		expect(
			readFileSync(join(staging, nestedId ?? '', `Transcript of ${forkedName}.md`), 'utf8'),
		).toBe(
			[
				`# Transcript of ${forkedName}`,
				'## User',
				`[attachment: ${transcriptName}] Carry on from the transcript`,
				'## Assistant',
				'Hello from the fake bridge',
				'[Result: done]',
			].join('\n\n') + '\n',
		);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('forking twice opens a new chat for each fork, right after the chat it came from', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-fork-twice-ws', 'Fork twice');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		const strip = page.getByTestId('chat-agent-tabs');
		const parentTab = strip.getByRole('tab', { name: /Explain the login flow/u });
		const composer = page.getByTestId('chat-composer-input');
		const transcriptChip = composer.getByLabel(
			'Attached file: Transcript of Explain the login flow.md',
		);

		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		await expect(transcriptChip).toBeVisible({ timeout: 20_000 });
		await expect(composer).toBeFocused();
		await page.keyboard.type('first fork draft');
		const firstForkTab = strip.getByRole('tab', { selected: true });
		const firstForkName = await firstForkTab.textContent();

		await parentTab.click();
		await expect(parentTab).toHaveAttribute('aria-selected', 'true');
		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		await expect(transcriptChip).toBeVisible({ timeout: 20_000 });
		await expect(composer.locator('[data-prompt-chip]')).toHaveCount(1);
		await expect(composer).not.toContainText('first fork draft');

		const names = (await strip.getByRole('tab').allTextContents()).map((name) => name.trim());
		const selected = (await strip.getByRole('tab', { selected: true }).textContent())?.trim();
		const parentIndex = names.findIndex((name) => /Explain the login flow/u.test(name));
		expect(selected).not.toBe(firstForkName?.trim());
		expect(names[parentIndex + 1]).toBe(selected);
		expect(names[parentIndex + 2]).toBe(firstForkName?.trim());

		await strip
			.getByRole('tab')
			.nth(parentIndex + 2)
			.click();
		await expect(composer).toContainText('first fork draft');
		await expect(transcriptChip).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('hovering the wide transcript chip shows its preview centered over the chip, inside the window', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-chip-preview-ws',
			'Chip preview workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		const chip = page
			.getByTestId('chat-composer-input')
			.getByLabel('Attached file: Transcript of Explain the login flow.md');
		await expect(chip).toBeVisible({ timeout: 20_000 });

		await chip.hover();
		const preview = page.getByTestId('chat-composer-chip-preview');
		await expect(preview).toBeVisible();
		await expect(preview).toContainText('Transcript of Explain the login flow.md');
		await expect(preview.getByText(/^\d+ B · Markdown$/u)).toBeVisible();
		await expect(preview).not.toContainText('text/plain');

		const chipBox = await chip.boundingBox();
		const previewBox = await preview.boundingBox();
		const viewportWidth = await page.evaluate<number>('innerWidth');
		if (!chipBox || !previewBox) throw new Error('the chip or its preview is not on screen');
		expect(previewBox.x + previewBox.width / 2).toBeCloseTo(chipBox.x + chipBox.width / 2, 0);
		expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(chipBox.y);
		expect(previewBox.x).toBeGreaterThanOrEqual(0);
		expect(previewBox.y).toBeGreaterThanOrEqual(0);
		expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(viewportWidth);
		await captureFlow(app, 'chip-preview-over-chip');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('forking a run stages the transcript in the fork only, never in the chat it came from', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-fork-parent-draft-ws',
			'Fork parent draft',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		const parent = currentSessionId(page);
		const strip = page.getByTestId('chat-agent-tabs');
		const parentTab = strip.getByRole('tab', { name: /Explain the login flow/u });
		const composer = page.getByTestId('chat-composer-input');
		const transcriptChip = composer.getByRole('button', {
			name: 'Remove Transcript of Explain the login flow.md',
		});
		const anyChip = composer.getByRole('button', { name: /^Remove /u });

		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		await expect(transcriptChip).toHaveCount(1, { timeout: 20_000 });
		const forkName = (await strip.getByRole('tab', { selected: true }).textContent())?.trim();

		await parentTab.click();
		await expect(parentTab).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => currentSessionId(page)).toBe(parent);
		await expect(composer).toHaveAttribute('aria-disabled', 'false');
		await expect(anyChip).toHaveCount(0);
		await captureFlow(app, 'fork-parent-after-fork');

		await strip.getByRole('tab', { name: forkName ?? '' }).hover();
		await page.getByRole('button', { name: `Close ${forkName}` }).click();
		await expect(strip.getByRole('tab', { name: forkName ?? '' })).toHaveCount(0);
		await expect(parentTab).toHaveAttribute('aria-selected', 'true');
		await expect(anyChip).toHaveCount(0);
		await expect(composer).toHaveText('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('removing a chip between two words sends the prompt with one space between them', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-chip-space-ws',
			'Chip space workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		const composer = page.getByTestId('chat-composer-input');
		const chip = composer.getByLabel('Attached file: Transcript of Explain the login flow.md');
		await expect(chip).toBeVisible({ timeout: 20_000 });
		await expect(composer).toBeFocused();
		await page.keyboard.type('and this end.');
		await page.keyboard.press('Control+a');
		await page.keyboard.type('Keep this sentence intact ');

		await chip.hover();
		await composer.getByRole('button', { name: /^Remove Transcript of/u }).click();
		await expect(chip).toHaveCount(0);
		const left = (await composer.evaluate((input) => input.textContent)) ?? '';
		expect(left).not.toMatch(/ {2}/u);
		expect(left.trim()).toBe('Keep this sentence intact and this end.');

		await page.getByTestId('chat-composer-submit').click();
		await expect.poll(() => currentSessionId(page), { timeout: 30_000 }).not.toBeNull();
		await expectAssistantReply(page);
		const prompt = (await listEvents(page, currentSessionId(page) ?? '')).find(
			(entry) => entry.event.type === 'user.message',
		)?.event;
		expect(prompt?.['text']).toBe('Keep this sentence intact and this end.');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('removing the only chip from a composer leaves it empty, with no draft behind', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-chip-only-ws',
			'Chip only workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		const composer = page.getByTestId('chat-composer-input');
		const chip = composer.getByLabel('Attached file: Transcript of Explain the login flow.md');
		await expect(chip).toBeVisible({ timeout: 20_000 });
		const draftIndicator = page.getByTestId('sidebar-workstream-draft');
		await expect(draftIndicator).toHaveCount(1);
		const fork = currentSessionId(page);
		const storedDraft = (): Promise<string | null> =>
			page.evaluate(
				(key) => globalThis.localStorage.getItem(key),
				`malini.chat.draft:${workstreamId}|${fork}`,
			);
		await expect.poll(storedDraft).not.toBeNull();

		await chip.hover();
		await composer.getByRole('button', { name: /^Remove Transcript of/u }).click();
		await expect(chip).toHaveCount(0);

		const prompt = page.getByRole('textbox', { name: 'Chat prompt' });
		await expect(prompt).toHaveText(/^$/u);
		await expect(prompt.locator('[data-placeholder="Ask malini to make a change…"]')).toHaveCount(
			1,
		);
		await captureFlow(app, 'only-chip-removed');
		await expect.poll(storedDraft).toBeNull();
		await expect(draftIndicator).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a new fork is named New chat again once the earlier fork tab is closed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-fork-name-ws',
			'Fork name workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Explain the login flow');
		await expectAssistantReply(page);
		const strip = page.getByTestId('chat-agent-tabs');
		const parentTab = strip.getByRole('tab', { name: /Explain the login flow/u });
		const newChatTab = strip.getByRole('tab', { name: /New chat$/u });

		for (let fork = 0; fork < 2; fork += 1) {
			await parentTab.click();
			await expect(parentTab).toHaveAttribute('aria-selected', 'true');
			await page.getByRole('button', { name: 'Fork to new chat' }).click();
			await expect(newChatTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
			await newChatTab.hover();
			await page.getByRole('button', { name: 'Close New chat', exact: true }).click();
			await expect(newChatTab).toHaveCount(0);
		}
		await expect(strip.getByRole('tab', { name: /New chat \d+$/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
