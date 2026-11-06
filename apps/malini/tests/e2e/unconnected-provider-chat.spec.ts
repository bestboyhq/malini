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

test('a new chat opens on a provider you have not connected, and its first message asks you to connect', async () => {
	test.setTimeout(180_000);
	const openai = await fakeOpenAi();
	const app = await launchMalini({
		env: { MALINI_CHATGPT_ISSUER: openai.url, MALINI_CHATGPT_RESOURCE: openai.resource },
	});
	try {
		const { page } = app;
		await recordBrowser(app);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-unconnected-ws',
			'Unconnected providers',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'SEARCH on Opus');
		await expectAssistantReply(page);

		await chooseModel(page, 'chatgpt', /^GPT-6 Luna/u);
		await expect(page.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeVisible();
		await startFreshChat(page);
		await expect(page.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeVisible();
		await expect(page.getByText(/Could not start agent chat/u)).toHaveCount(0);
		await captureFlow(app, 'unconnected-provider-new-chat');

		await sendPrompt(page, 'SEARCH on my ChatGPT plan');
		const connect = page.getByTestId('provider-connect-card');
		await expect(connect).toHaveAttribute('data-access', 'chatgpt-signed-out');
		await connect.getByRole('button', { name: 'Continue with ChatGPT' }).click();
		await expect.poll(async () => (await openedUrls(app)).length).toBe(1);
		expect((await fetch((await openedUrls(app))[0] ?? '')).status).toBe(200);
		await expect(connect).toHaveCount(0);
		await expect.poll(() => sessionEnvironment(app.home, 'gpt-6-luna')).not.toBeNull();
		await expectAssistantReply(page);

		await chooseModel(page, 'deepseek', /^DeepSeek V4 Pro/u);
		await startFreshChat(page);
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible();
		await expect(page.getByText(/Could not start agent chat/u)).toHaveCount(0);

		await sendPrompt(page, 'SEARCH on DeepSeek');
		await expect(connect).toHaveAttribute('data-access', 'needs-key');
		await page.getByRole('textbox', { name: 'DeepSeek API key' }).fill('sk-e2e-deepseek');
		await page.getByTestId('provider-connect-submit').click();
		await expect(connect).toHaveCount(0);
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
