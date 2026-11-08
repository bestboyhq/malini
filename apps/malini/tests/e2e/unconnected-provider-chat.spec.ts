import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeOpenAi } from './fake-openai';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	openedUrls,
	recordBrowser,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
} from './harness';

function sessionEnvironment(home: string, model: string): Record<string, string> | null {
	const path = join(home, 'malini-session-envs.jsonl');
	if (!existsSync(path)) return null;
	const entry = readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line): unknown => JSON.parse(line))
		.filter((candidate) => Reflect.get(Object(candidate), 'model') === model)
		.at(-1);
	const env: unknown = Reflect.get(Object(entry), 'env');
	return typeof env === 'object' && env !== null
		? Object.fromEntries(Object.entries(env).map(([name, value]) => [name, String(value)]))
		: null;
}

async function chooseModel(page: Page, provider: string, model: RegExp): Promise<void> {
	await page.getByTestId('chat-composer-model').click();
	await page.getByRole('listbox', { name: 'Models' }).getByRole('option', { name: model }).hover();
	await page.locator(`[data-testid="chat-model-runner"][data-provider="${provider}"]`).click();
}

test('a message to a provider you have not connected sends, and waits under the prompt until you connect', async () => {
	test.setTimeout(240_000);
	const openai = await fakeOpenAi();
	const env = { MALINI_CHATGPT_ISSUER: openai.url, MALINI_CHATGPT_RESOURCE: openai.resource };
	const first = await launchMalini({ env });
	let workstreamId = '';
	let waitingChat = '';
	try {
		const { page } = first;
		const source = await createSourceRepo(first.root);
		({ workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-unconnected-ws',
			'Unconnected providers',
		));
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'SEARCH on Opus');
		await expectAssistantReply(page);

		await chooseModel(page, 'chatgpt', /^GPT-6 Luna/u);
		await expect(page.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeVisible();
		await startFreshChat(page);
		await expect(page.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeVisible();
		await expect(page.getByText(/Could not start agent chat/u)).toHaveCount(0);
		await captureFlow(first, 'unconnected-provider-new-chat');

		await sendPrompt(page, 'SEARCH on my ChatGPT plan');
		const strip = page.getByTestId('provider-connect-strip');
		const draft = page.getByTestId('chat-composer-input');
		const signIn = strip.getByRole('button', { name: 'Continue with ChatGPT' });
		const sent = page.getByTestId('chat-message-bubble-user');
		await expect(strip).toHaveAttribute('data-access', 'chatgpt-signed-out');
		await expect(sent).toHaveText(['SEARCH on my ChatGPT plan']);
		await expect(draft).toHaveText('');
		await expect(page.locator('[data-queued-prompt-id]')).toHaveCount(0);
		await expect(page.getByTestId('sidebar-prompt-queue-count')).toHaveCount(0);
		await expect(signIn).toBeFocused();
		await captureFlow(first, 'unconnected-provider-connect-strip');

		await page.keyboard.press('Escape');
		await expect(strip).toHaveCount(0);
		await expect(sent).toHaveCount(0);
		await expect(draft).toHaveText('SEARCH on my ChatGPT plan');
		await expect(draft).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(signIn).toBeFocused();
		await expect(draft).toHaveText('');

		waitingChat =
			(await page.getByTestId('chat-message-viewport').getAttribute('data-session-id')) ?? '';
		expect(waitingChat).not.toBe('');
		const waitingTab = page.locator(
			`[data-testid="chat-agent-tab"][data-session-id="${waitingChat}"]`,
		);
		await page
			.locator(`[data-testid="chat-agent-tab"]:not([data-session-id="${waitingChat}"])`)
			.click();
		await expect(strip).toHaveCount(0);
		await waitingTab.click();
		await expect(strip).toHaveAttribute('data-access', 'chatgpt-signed-out');
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		openai.close();
		throw error;
	}

	const app = await launchMalini({ env, profile: first.root });
	try {
		const { page } = app;
		await recordBrowser(app);
		await openWorkstream(page, workstreamId, waitingChat);
		const strip = page.getByTestId('provider-connect-strip');
		const signIn = strip.getByRole('button', { name: 'Continue with ChatGPT' });
		await expect(page.getByTestId('chat-message-bubble-user')).toHaveText([
			'SEARCH on my ChatGPT plan',
		]);
		await signIn.click();
		await expect.poll(async () => (await openedUrls(app)).length).toBe(1);
		expect((await fetch((await openedUrls(app))[0] ?? '')).status).toBe(200);
		await expect(strip).toHaveCount(0);
		await expect.poll(() => sessionEnvironment(app.home, 'gpt-6-luna')).not.toBeNull();
		await expectAssistantReply(page);

		await chooseModel(page, 'deepseek', /^DeepSeek V4 Pro/u);
		await startFreshChat(page);
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible();
		await expect(page.getByText(/Could not start agent chat/u)).toHaveCount(0);

		await sendPrompt(page, 'SEARCH on DeepSeek');
		await expect(strip).toHaveAttribute('data-access', 'needs-key');
		const key = page.getByRole('textbox', { name: 'DeepSeek API key' });
		await expect(key).toBeFocused();
		await key.fill('sk-e2e-deepseek');
		await page.getByTestId('provider-connect-submit').click();
		await expect(strip).toHaveCount(0);
		await expect
			.poll(() => sessionEnvironment(app.home, 'deepseek-v4-pro')?.['ANTHROPIC_AUTH_TOKEN'])
			.toBe('sk-e2e-deepseek');
		await expectAssistantReply(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
		openai.close();
	}
});
