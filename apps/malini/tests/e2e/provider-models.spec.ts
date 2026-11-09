import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

function modelOptions(page: Page, provider: string): Locator {
	return page.locator(`[data-testid="chat-model-option"][data-provider="${provider}"]`);
}

function runner(page: Page, provider: string): Locator {
	return page.locator(`[data-testid="chat-model-runner"][data-provider="${provider}"]`);
}

function catalogModel(id: string, name: string, releaseDate: string): Record<string, unknown> {
	return {
		id,
		name,
		tool_call: true,
		reasoning: true,
		reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
		modalities: { input: ['text'], output: ['text'] },
		limit: { context: 262_144 },
		cost: { input: 1, output: 2 },
		release_date: releaseDate,
	};
}

interface CatalogServer {
	readonly url: string;
	requests(): number;
	close(): Promise<void>;
}

async function serveModelsDev(catalog: unknown): Promise<CatalogServer> {
	let requests = 0;
	const server = createServer((_request, response) => {
		requests += 1;
		response.writeHead(200, { 'content-type': 'application/json', etag: '"e2e-catalog"' });
		response.end(JSON.stringify(catalog));
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : 0;
	return {
		url: `http://localhost:${port}/api.json`,
		requests: () => requests,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

interface ProbeServer {
	readonly origin: string;
	answer(inference: number): void;
	report(usage: { percent: number } | null): void;
	close(): Promise<void>;
}

async function serveOpenCodeProbe(
	inference: number,
	usage: { percent: number } | null = null,
): Promise<ProbeServer> {
	let answer = inference;
	let reported = usage;
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		if (request.url?.endsWith('/inference/go/anthropic/v1/messages')) {
			response.writeHead(answer);
			response.end('{}');
			return;
		}
		if (request.url?.endsWith('/zen/go/v1/usage')) {
			if (!reported) {
				response.writeHead(403);
				response.end('{}');
				return;
			}
			response.writeHead(200);
			response.end(
				JSON.stringify({
					usage: {
						rolling: {
							percent: reported.percent,
							status: 'ok',
							resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
						},
						weekly: {
							percent: 12,
							status: 'ok',
							resetsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
						},
						monthly: {
							percent: 34,
							status: 'ok',
							resetsAt: new Date(Date.now() + 720 * 3_600_000).toISOString(),
						},
					},
				}),
			);
			return;
		}
		response.writeHead(200);
		response.end(JSON.stringify({ data: [{ id: 'glm-6' }] }));
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : 0;
	return {
		origin: `http://localhost:${port}`,
		answer: (next) => {
			answer = next;
		},
		report: (next) => {
			reported = next;
		},
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
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
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-provider-models-ws',
			'Provider models',
		);
		await openWorkstream(page, workstreamId);

		await expect(page.getByRole('button', { name: 'Model: Opus 5.5' })).toBeVisible({
			timeout: 20_000,
		});
		const usage = page.getByRole('button', { name: /^View context and plan usage/u });
		const panel = page.getByRole('dialog', { name: 'Context and plan usage' });
		const others = panel.getByRole('list', { name: 'Other providers' });
		await usage.hover();
		await expect(panel.getByRole('region', { name: 'Claude', exact: true })).toBeVisible();
		await expect(others).toHaveCount(0);
		await page.mouse.move(0, 0);
		await expect(panel).toHaveCount(0);
		await page.getByTestId('chat-composer-model').click();
		const models = page.getByRole('listbox', { name: 'Models' });
		await expect(models.getByRole('option', { name: /^Opus 5\.5/u })).toHaveCount(1);
		await expect(modelOptions(page, 'claude')).toHaveCount(2);
		await expect(modelOptions(page, 'deepseek')).toHaveCount(2);
		await expect(models.getByRole('option', { name: /^GPT-6\.1 Sol/u })).toHaveAttribute(
			'data-provider',
			'opencode',
		);
		await expect(models.getByRole('option', { name: /^GPT-6 Sol/u })).toHaveCount(0);
		await models.getByRole('option', { name: /^DeepSeek V4 Pro/u }).hover();
		const runners = page.getByRole('listbox', { name: 'DeepSeek V4 Pro runs on' });
		await expect(runners).toBeVisible();
		await expect(runner(page, 'deepseek')).toContainText('Needs a key');
		await expect(runner(page, 'opencode')).toContainText('Needs a key');
		await captureFlow(app, 'provider-models-picker');
		await runner(page, 'deepseek').click();
		await expect(models).toBeHidden();
		await expect(runners).toBeHidden();
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible();

		await sendPrompt(page, 'SEARCH the fixture repo');
		await expect(page.getByTestId('provider-connect-strip')).toBeVisible();
		await expect(page.getByTestId('provider-connect-strip')).toHaveAttribute(
			'data-access',
			'needs-key',
		);
		await expect(page.getByTestId('chat-message-bubble-user')).toHaveText([
			'SEARCH the fixture repo',
		]);
		await expect(page.getByTestId('provider-connect-key')).toBeFocused();
		await captureFlow(app, 'provider-models-connect-card');
		await page.getByRole('textbox', { name: 'DeepSeek API key' }).fill('sk-e2e-deepseek');
		await page.getByTestId('provider-connect-submit').click();
		await expect(page.getByTestId('provider-connect-strip')).toHaveCount(0);

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
		await usage.hover();
		await expect(panel.getByRole('region', { name: 'DeepSeek' })).toContainText('API key');
		await expect(panel.getByRole('region', { name: 'Claude', exact: true })).toHaveCount(0);
		await expect(others.getByRole('listitem')).toHaveText(['Claude Claude Max']);
		await captureFlow(app, 'provider-models-connected-providers');
		await page.mouse.move(0, 0);
		await expect(panel).toHaveCount(0);
		await captureFlow(app, 'provider-models-deepseek-run');

		await page.reload();
		await expect(page.getByRole('button', { name: 'Model: DeepSeek V4 Pro' })).toBeVisible({
			timeout: 20_000,
		});
		await page.getByTestId('chat-composer-model').click();
		const pro = page.getByRole('option', { name: /^DeepSeek V4 Pro/u });
		await expect(pro).toHaveAttribute('aria-selected', 'true');
		await pro.focus();
		await page.keyboard.press('ArrowRight');
		await expect(runner(page, 'deepseek')).toBeFocused();
		await expect(runner(page, 'deepseek')).toContainText('Key saved');
		await expect(runner(page, 'deepseek')).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowDown');
		await expect(runner(page, 'opencode')).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByTestId('chat-model-runners')).toHaveCount(0);
		await expect(pro).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();

		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('provider-deepseek')).toHaveAttribute('data-key-saved', 'true');
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

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

test('an OpenCode run uses the models models.dev lists and the OpenCode key', async () => {
	test.setTimeout(180_000);
	const catalog = await serveModelsDev({
		opencode: {
			id: 'opencode',
			models: {
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
				'kimi-k4': catalogModel('kimi-k4', 'Kimi K4', '2026-10-20'),
				'kimi-k4-free': {
					...catalogModel('kimi-k4-free', 'Kimi K4 Free', '2026-10-20'),
					cost: { input: 0, output: 0 },
				},
			},
		},
		'opencode-go': {
			id: 'opencode-go',
			models: {
				hy4: catalogModel('hy4', 'Hy4', '2026-10-31'),
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
			},
		},
	});
	const probe = await serveOpenCodeProbe(403);
	const app = await launchMalini({
		env: { MALINI_MODELS_DEV_URL: catalog.url, MALINI_OPENCODE_PROBE_URL: probe.origin },
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-provider-opencode-ws',
			'OpenCode models',
		);
		await openWorkstream(page, workstreamId);
		await expect(page.getByRole('button', { name: 'Model: Opus' })).toBeVisible({
			timeout: 20_000,
		});

		await page.getByTestId('chat-composer-model').click();
		await expect(modelOptions(page, 'opencode')).toHaveText([/^GLM-6/u, /^Kimi K4/u]);
		const filter = page.getByRole('textbox', { name: 'Find models' });
		await expect(filter).toBeFocused();
		await filter.fill('glm opencode');
		await expect(page.getByTestId('chat-model-option')).toHaveCount(1);
		await captureFlow(app, 'provider-models-opencode-filter');
		await filter.press('Enter');
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();
		await expect(page.getByRole('button', { name: 'Model: GLM-6' })).toBeVisible();
		await page.getByTestId('chat-composer-model').click();
		await expect(modelOptions(page, 'opencode')).toContainText(['GLM-6', 'Kimi K4']);
		await expect(page.getByRole('option', { name: /GLM-6/u, selected: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();

		await sendPrompt(page, 'SEARCH the fixture repo');
		await expect(page.getByTestId('provider-connect-strip')).toHaveAttribute(
			'data-access',
			'needs-key',
		);
		await expect(page.getByRole('link', { name: 'Get a key' })).toHaveAttribute(
			'href',
			'https://opencode.ai/console',
		);
		await page.getByRole('textbox', { name: 'OpenCode API key' }).fill('oc_sk_e2e');
		await page.getByTestId('provider-connect-submit').click();
		await expect(page.getByTestId('provider-connect-strip')).toHaveCount(0);
		await expect
			.poll(
				() => sessionEnvironments(app.home).find((entry) => entry.model === 'glm-6')?.env ?? null,
			)
			.toEqual({
				ANTHROPIC_BASE_URL: 'https://opencode.ai/inference/anthropic',
				ANTHROPIC_AUTH_TOKEN: 'oc_sk_e2e',
				ANTHROPIC_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-6',
				CLAUDE_CODE_SUBAGENT_MODEL: 'glm-6',
			});
		await expectAssistantReply(page);
		await expect(page.getByTestId('session-plan-limit-alert')).toHaveCount(0);

		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
		const card = page.getByTestId('provider-opencode');
		await expect(card).toHaveAttribute('data-key-saved', 'true');
		await expect(card).toContainText('API key saved on this Mac.');
		await expect(card.getByRole('button', { name: 'Check again' })).toBeVisible();
		await expect(card.getByRole('list', { name: 'OpenCode models' })).toHaveText(
			/GLM-6\s*Kimi K4/u,
		);
		await captureFlow(app, 'provider-models-opencode-settings');
		expect(catalog.requests()).toBe(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
		await catalog.close();
		await probe.close();
	}
});

test('a Go key lists Go models, runs them on the Go endpoint, and checks again', async () => {
	test.setTimeout(180_000);
	const catalog = await serveModelsDev({
		opencode: {
			id: 'opencode',
			models: {
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
				'kimi-k4': catalogModel('kimi-k4', 'Kimi K4', '2026-10-20'),
			},
		},
		'opencode-go': {
			id: 'opencode-go',
			models: {
				hy4: catalogModel('hy4', 'Hy4', '2026-10-31'),
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
			},
		},
	});
	const probe = await serveOpenCodeProbe(200);
	const app = await launchMalini({
		env: { MALINI_MODELS_DEV_URL: catalog.url, MALINI_OPENCODE_PROBE_URL: probe.origin },
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-provider-opencode-go-ws',
			'OpenCode Go models',
		);
		await openWorkstream(page, workstreamId);
		await expect(page.getByRole('button', { name: 'Model: Opus' })).toBeVisible({
			timeout: 20_000,
		});

		await chooseModel(page, 'opencode', 'glm-6');
		await sendPrompt(page, 'SEARCH the fixture repo');
		await expect(page.getByTestId('provider-connect-strip')).toHaveAttribute(
			'data-access',
			'needs-key',
		);
		await page.getByRole('textbox', { name: 'OpenCode API key' }).fill('oc_sk_go_e2e');
		await page.getByTestId('provider-connect-submit').click();
		await expect(page.getByTestId('provider-connect-strip')).toHaveCount(0);
		await expect
			.poll(
				() => sessionEnvironments(app.home).find((entry) => entry.model === 'glm-6')?.env ?? null,
			)
			.toEqual({
				ANTHROPIC_BASE_URL: 'https://opencode.ai/inference/go/anthropic',
				ANTHROPIC_AUTH_TOKEN: 'oc_sk_go_e2e',
				ANTHROPIC_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-6',
				ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-6',
				CLAUDE_CODE_SUBAGENT_MODEL: 'glm-6',
			});
		await expectAssistantReply(page);

		const trigger = page.getByRole('button', { name: /^View context and plan usage/u });
		const panel = page.getByRole('dialog', { name: 'Context and plan usage' });
		await trigger.hover();
		await expect(panel.getByRole('region', { name: 'OpenCode' })).toContainText(
			'Usage limits show once OpenCode reports them.',
		);
		await page.mouse.move(10, 10);
		await expect(panel).toBeHidden();

		probe.report({ percent: 96 });
		await trigger.hover();
		await expect(trigger).toHaveAccessibleName(/5-hour limit 96% used/u);
		await expect(page.getByTestId('session-plan-limit-alert')).toHaveText('96% used');
		await expect(panel.getByTestId('session-opencode-usage')).toBeVisible();
		await expect(panel).not.toContainText('Usage limits show once OpenCode reports them.');
		await expect(panel.getByRole('progressbar', { name: '5-hour limit used' })).toHaveAttribute(
			'aria-valuenow',
			'96',
		);
		await page.mouse.move(10, 10);
		await expect(panel).toBeHidden();
		await expect(trigger).toHaveAccessibleName(/5-hour limit 96% used/u);

		await chooseModel(page, 'claude', 'opus');
		await expect(page.getByTestId('session-plan-limit-alert')).toHaveCount(0);
		await trigger.hover();
		await expect(panel.getByTestId('session-opencode-usage')).toHaveCount(0);
		await expect(
			panel
				.getByRole('list', { name: 'Other providers' })
				.getByRole('listitem')
				.filter({ hasText: 'OpenCode' }),
		).toContainText('5-hour · 96%');
		await captureFlow(app, 'provider-models-opencode-go-other-providers');
		await page.mouse.move(10, 10);
		await expect(panel).toBeHidden();

		await page.getByTestId('chat-composer-model').click();
		await expect(modelOptions(page, 'opencode')).toHaveText([/^Hy4/u, /^GLM-6/u]);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();

		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible({ timeout: 20_000 });
		const card = page.getByTestId('provider-opencode');
		await expect(card).toHaveAttribute('data-key-saved', 'true');
		await expect(card).toContainText('Key saved. Your Go plan.');
		await expect(card.getByRole('list', { name: 'OpenCode models' })).toHaveText(/Hy4\s*GLM-6/u);
		await expect(card).not.toContainText('Kimi K4');
		await captureFlow(app, 'provider-models-opencode-go-settings');

		probe.answer(403);
		await card.getByRole('button', { name: 'Check again' }).click();
		await expect(card).toContainText('API key saved on this Mac.');
		await expect(card.getByRole('list', { name: 'OpenCode models' })).toHaveText(
			/GLM-6\s*Kimi K4/u,
		);
		await captureFlow(app, 'provider-models-opencode-go-checked-again');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await catalog.close();
		await probe.close();
	}
});
