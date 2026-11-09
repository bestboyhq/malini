import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHATGPT_EMAIL, fakeOpenAi } from './fake-openai';
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
} from './harness';

function runEnvironment(home: string, model: string): Record<string, string> | null {
	const path = join(home, 'malini-session-envs.jsonl');
	if (!existsSync(path)) return null;
	const entries: unknown[] = readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const entry = entries
		.filter((candidate) => Reflect.get(Object(candidate), 'model') === model)
		.at(-1);
	const env: unknown = Reflect.get(Object(entry), 'env');
	return typeof env === 'object' && env !== null
		? Object.fromEntries(Object.entries(env).map(([name, value]) => [name, String(value)]))
		: null;
}

function runner(page: Page, provider: string): Locator {
	return page.locator(`[data-testid="chat-model-runner"][data-provider="${provider}"]`);
}

function claudeCodeTurn(): string {
	return JSON.stringify({
		model: 'gpt-6-luna',
		max_tokens: 32_000,
		stream: true,
		system: [{ type: 'text', text: 'You are Claude Code.' }],
		messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hello.' }] }],
	});
}

test('a GPT model runs on a ChatGPT plan that offers it after one sign-in, through a proxy only Malini can use', async () => {
	test.setTimeout(180_000);
	const openai = await fakeOpenAi();
	const env = { MALINI_CHATGPT_ISSUER: openai.url, MALINI_CHATGPT_RESOURCE: openai.resource };
	let app = await launchMalini({ env });
	try {
		const { page } = app;
		await recordBrowser(app);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-chatgpt-ws', 'ChatGPT plan');
		await openWorkstream(page, workstreamId);
		await expect(page.getByRole('button', { name: /^Model: Opus/u })).toBeVisible({
			timeout: 20_000,
		});

		await page.getByTestId('chat-composer-model').click();
		const models = page.getByRole('listbox', { name: 'Models' });
		await models.getByRole('option', { name: /^GPT-5\.6 Terra/u }).hover();
		await expect(page.getByRole('listbox', { name: 'GPT-5.6 Terra runs on' })).toBeVisible();
		await expect(runner(page, 'chatgpt')).toContainText('Needs a sign-in');
		await expect(runner(page, 'opencode')).toContainText('Needs a key');
		await captureFlow(app, 'chatgpt-picker');
		await runner(page, 'chatgpt').click();
		await expect(page.getByRole('button', { name: 'Model: GPT-5.6 Terra' })).toBeVisible();

		await sendPrompt(page, 'SEARCH the fixture repo');
		const connect = page.getByTestId('provider-connect-strip');
		await expect(connect).toHaveAttribute('data-access', 'chatgpt-signed-out');
		await expect(connect).toContainText('Sign in to ChatGPT to run this');
		await connect.getByRole('button', { name: 'Continue with ChatGPT' }).click();
		await expect(connect.getByRole('status')).toHaveText('Continue in your browser');
		await expect.poll(async () => (await openedUrls(app)).length).toBe(1);
		const authorize = new URL((await openedUrls(app))[0] ?? '');
		expect(`${authorize.origin}${authorize.pathname}`).toBe(`${openai.url}/oauth/authorize`);
		expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client');
		expect(authorize.searchParams.get('agent_name_hint')).toBe('Malini');
		expect(authorize.searchParams.get('resource')).toBe(openai.resource);
		await captureFlow(app, 'chatgpt-connect-waiting');

		expect((await fetch(authorize)).status).toBe(200);
		await expect(connect).toHaveAttribute('data-access', 'chatgpt-model-missing');
		await expect(connect).toContainText('Not on your ChatGPT plan');
		await captureFlow(app, 'chatgpt-model-missing');
		expect(existsSync(join(app.home, 'malini-plugins.jsonl'))).toBe(false);

		await connect.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(connect).toHaveCount(0);
		await expect(page.getByTestId('chat-composer-input')).toHaveText('SEARCH the fixture repo');
		await page.getByTestId('chat-composer-model').click();
		await models.getByRole('option', { name: /^GPT-6 Luna/u }).hover();
		await runner(page, 'chatgpt').click();
		await expect(page.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeVisible();
		await page.getByTestId('chat-composer-submit').click();
		await expect.poll(() => runEnvironment(app.home, 'gpt-6-luna')).not.toBeNull();
		const run = runEnvironment(app.home, 'gpt-6-luna') ?? {};
		expect(run).toEqual({
			ANTHROPIC_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/u),
			ANTHROPIC_AUTH_TOKEN: expect.stringMatching(/^\S{32,}$/u),
			ANTHROPIC_MODEL: 'gpt-6-luna',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-6-luna',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-6-luna',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-6-luna',
			CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-6-luna',
		});
		expect(run['ANTHROPIC_AUTH_TOKEN']).not.toContain('at-e2e');
		await expectAssistantReply(page);

		const messages = `${run['ANTHROPIC_BASE_URL']}/v1/messages`;
		const turn = (token: string): Promise<Response> =>
			fetch(messages, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					'x-claude-code-session-id': 'e2e-session',
				},
				body: claudeCodeTurn(),
			});
		expect((await turn('not-the-secret')).status).toBe(401);
		const reply = await turn(run['ANTHROPIC_AUTH_TOKEN'] ?? '');
		expect(reply.status).toBe(200);
		expect(reply.headers.get('content-type')).toMatch(/^text\/event-stream/u);
		const stream = await reply.text();
		expect(stream).toContain('event: message_start');
		expect(stream).toContain('"text":"Hello from GPT-6 Luna"');
		expect(stream).toContain('"stop_reason":"end_turn"');
		expect(openai.responses).toHaveLength(1);
		expect(openai.responses[0]?.headers).toMatchObject({
			authorization: 'Bearer at-e2e-1',
			'session-id': 'e2e-session',
			'user-agent': expect.stringMatching(/^Malini\//u),
		});
		expect(openai.responses[0]?.body).toMatchObject({
			model: 'gpt-6-luna',
			store: false,
			stream: true,
			instructions: 'You are Claude Code.',
			prompt_cache_key: 'e2e-session',
		});

		const usage = page.getByRole('button', { name: /^View context and plan usage/u });
		const account = page
			.getByRole('dialog', { name: 'Context and plan usage' })
			.getByRole('region', { name: 'ChatGPT', exact: true });
		await usage.hover();
		await expect(account).toContainText(CHATGPT_EMAIL);
		await expect(account).toContainText('Using ChatGPT plan');
		await expect(account.getByRole('link', { name: 'Manage usage' })).toHaveAttribute(
			'href',
			'https://chatgpt.com/settings/usage',
		);
		await captureFlow(app, 'chatgpt-context-card');
		await page.mouse.move(0, 0);
		await expect(account).toHaveCount(0);

		openai.replyWithUsageLimit();
		const limited = await turn(run['ANTHROPIC_AUTH_TOKEN'] ?? '');
		expect(limited.status).toBe(429);
		expect(limited.headers.get('x-should-retry')).toBe('false');
		expect(await limited.text()).toContain('You hit your ChatGPT usage limit.');
		await usage.hover();
		await expect(account).toContainText('You hit your ChatGPT usage limit.');
		await page.mouse.move(0, 0);
		await expect(account).toHaveCount(0);

		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
		const card = page.getByTestId('provider-chatgpt');
		await expect(card).toHaveAttribute('data-signed-in', 'true');
		await expect(card).toContainText(`Using ChatGPT plan · ${CHATGPT_EMAIL}`);
		await expect(card.getByRole('list', { name: 'ChatGPT models' })).toHaveText(
			/^GPT-6 Luna\s*GPT-5\.6 Luna$/u,
		);
		await captureFlow(app, 'chatgpt-settings');
		await card.getByRole('button', { name: 'Sign out of ChatGPT' }).click();
		await expect(card).toHaveAttribute('data-signed-in', 'false');
		await expect(card.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
		expect(openai.revoked.map((form) => form.get('token'))).toEqual(['rt-e2e-1']);
		expect((await turn(run['ANTHROPIC_AUTH_TOKEN'] ?? '')).status).toBe(401);
		expectCleanConsole(app);

		await app.quit();
		openai.dropModel('gpt-6-luna');
		app = await launchMalini({ profile: app.root, env });
		const reopened = app.page;
		await recordBrowser(app);
		await openWorkstream(reopened, workstreamId);
		await expectAssistantReply(reopened);
		await expect(reopened.getByTestId('agent-session-error')).toHaveCount(0);
		await expect(reopened.getByRole('button', { name: 'Model: GPT-6 Luna' })).toBeEnabled();

		await sendPrompt(reopened, 'SEARCH it again');
		const again = reopened.getByTestId('provider-connect-strip');
		await expect(again).toHaveAttribute('data-access', 'chatgpt-signed-out');
		await again.getByRole('button', { name: 'Continue with ChatGPT' }).click();
		await expect.poll(async () => (await openedUrls(app)).length).toBe(1);
		expect((await fetch((await openedUrls(app))[0] ?? '')).status).toBe(200);
		await expect(again).toHaveAttribute('data-access', 'chatgpt-model-missing');
		await again.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(again).toHaveCount(0);
		await expect(reopened.getByTestId('chat-composer-input')).toHaveText('SEARCH it again');

		await reopened.getByTestId('chat-composer-model').click();
		await reopened
			.getByRole('listbox', { name: 'Models' })
			.getByRole('option', { name: /^GPT-5\.6 Luna/u })
			.hover();
		await runner(reopened, 'chatgpt').click();
		await expect(reopened.getByRole('button', { name: 'Model: GPT-5.6 Luna' })).toBeVisible();
		await reopened.getByTestId('chat-composer-submit').click();
		await expect.poll(() => runEnvironment(app.home, 'gpt-5.6-luna')).not.toBeNull();
		expectCleanConsole(app);
	} finally {
		await app.close();
		openai.close();
	}
});
