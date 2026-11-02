import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

interface SessionEnvironment {
	sessionId: string;
	model: string | null;
	env: Record<string, string>;
}

function sessionEnvironments(home: string): SessionEnvironment[] {
	const path = join(home, 'malini-session-envs.jsonl');
	if (!existsSync(path)) return [];
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			const entry = toSessionEnvironment(JSON.parse(line));
			return entry === null ? [] : [entry];
		});
}

function toSessionEnvironment(value: unknown): SessionEnvironment | null {
	if (!isRecord(value)) return null;
	const { sessionId, model, env } = value;
	if (typeof sessionId !== 'string') return null;
	if (model !== null && typeof model !== 'string') return null;
	if (!isStringRecord(env)) return null;
	return { sessionId, model, env };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function claudeRuns(home: string): SessionEnvironment[] {
	return sessionEnvironments(home).filter((entry) => entry.model === 'opus');
}

async function chooseModel(page: Page, provider: string, model: string): Promise<void> {
	await page.getByTestId('chat-composer-model').click();
	await page
		.locator(
			`[data-testid="chat-model-option"][data-provider="${provider}"][data-model="${model}"]`,
		)
		.click();
	await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();
}

test('a DeepSeek run starts with its provider environment while a Claude run starts with none', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible({ timeout: 20_000 });
		const deepseek = page.getByTestId('provider-deepseek');
		await expect(deepseek).toHaveAttribute('data-key-saved', 'false');
		await page.getByRole('textbox', { name: 'DeepSeek API key' }).fill('sk-e2e-deepseek');
		await page.getByRole('button', { name: 'Save DeepSeek API key' }).click();
		await expect(deepseek).toHaveAttribute('data-key-saved', 'true');
		await expect(deepseek).toContainText('Ready');
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-provider-models-ws',
			'Provider models',
		);
		await openWorkstream(page, workstreamId);

		await expect(page.getByRole('button', { name: 'Model: Opus' })).toBeVisible({
			timeout: 20_000,
		});
		await page.getByTestId('chat-composer-model').click();
		await expect(page.getByTestId('chat-model-group')).toHaveText(['Claude', 'DeepSeek']);
		await expect(
			page.locator('[data-testid="chat-model-option"][data-provider="deepseek"]'),
		).toHaveCount(2);
		await expect(
			page.locator('[data-testid="chat-model-option"][data-provider="claude"]'),
		).toHaveCount(2);
		await captureFlow(app, 'provider-models-picker');
		await page
			.locator(
				'[data-testid="chat-model-option"][data-provider="deepseek"][data-model="deepseek-v4-pro"]',
			)
			.click();
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible();

		await sendPrompt(page, 'SEARCH the fixture repo');
		await expect
			.poll(
				() =>
					sessionEnvironments(app.home).find((entry) => entry.model === 'deepseek-v4-pro')?.env ??
					null,
			)
			.toEqual({
				ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
				ANTHROPIC_AUTH_TOKEN: 'sk-e2e-deepseek',
				ANTHROPIC_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-pro',
				CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
			});
		await expectAssistantReply(page);
		await captureFlow(app, 'provider-models-deepseek-run');

		await page.reload();
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible({
			timeout: 20_000,
		});

		const before = claudeRuns(app.home).length;
		await chooseModel(page, 'claude', 'opus');
		await sendPrompt(page, 'SEARCH the fixture repo again');
		await expect
			.poll(() => claudeRuns(app.home).length, { timeout: 30_000 })
			.toBeGreaterThan(before);
		expect(claudeRuns(app.home).at(-1)?.env).toEqual({});
		await expectAssistantReply(page);
		await captureFlow(app, 'provider-models-claude-run');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
