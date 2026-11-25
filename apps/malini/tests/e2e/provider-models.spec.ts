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

const LOCAL_TOKEN = /^(?!sk-|oc_sk_)\S{32,}$/u;

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
				ANTHROPIC_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/deepseek$/u),
				ANTHROPIC_AUTH_TOKEN: expect.stringMatching(LOCAL_TOKEN),
				ANTHROPIC_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
				ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-pro',
				CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
			});
		const proxied = sessionEnvironments(app.home).find(
			(entry) => entry.model === 'deepseek-v4-pro',
		)?.env;
		const stranger = await fetch(`${proxied?.['ANTHROPIC_BASE_URL']}/v1/messages`, {
			method: 'POST',
			headers: { authorization: 'Bearer sk-e2e-deepseek' },
			body: '{}',
		});
		expect(stranger.status).toBe(401);
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
				'kimi-k4': { ...catalogModel('kimi-k4', 'Kimi K4', '2026-10-20'), family: 'kimi' },
				'kimi-k4-code': {
					...catalogModel('kimi-k4-code', 'Kimi K4 Code', '2026-10-12'),
					family: 'kimi',
				},
				'kimi-k3': { ...catalogModel('kimi-k3', 'Kimi K3', '2026-07-16'), family: 'kimi' },
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
		await expect(modelOptions(page, 'opencode')).toHaveText([
			/^GLM-6/u,
			/^Kimi K4(?! Code)/u,
			/^Kimi K4 Code/u,
		]);
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
				ANTHROPIC_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/opencode$/u),
				ANTHROPIC_AUTH_TOKEN: expect.stringMatching(LOCAL_TOKEN),
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

test('typing in the picker finds an earlier Claude version, and a run uses it', async () => {
	test.setTimeout(180_000);
	const catalog = await serveModelsDev({
		anthropic: {
			id: 'anthropic',
			models: {
				'claude-opus-4-8': {
					...catalogModel('claude-opus-4-8', 'Claude Opus 4.8', '2026-05-28'),
					family: 'claude-opus',
				},
				'claude-opus-4-5': {
					...catalogModel('claude-opus-4-5', 'Claude Opus 4.5 (latest)', '2025-11-24'),
					family: 'claude-opus',
				},
				'claude-sonnet-4-6': {
					...catalogModel('claude-sonnet-4-6', 'Claude Sonnet 4.6', '2026-02-17'),
					family: 'claude-sonnet',
				},
				'claude-haiku-4-5': {
					...catalogModel('claude-haiku-4-5', 'Claude Haiku 4.5', '2025-10-15'),
					family: 'claude-haiku',
				},
			},
		},
	});
	const app = await launchMalini({ env: { MALINI_MODELS_DEV_URL: catalog.url } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-provider-claude-versions-ws',
			'Earlier Claude versions',
		);
		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: /^Model: / });
		await expect(picker).toHaveCount(1, { timeout: 20_000 });

		await picker.click();
		const models = page.getByRole('listbox', { name: 'Models' });
		const earlier = models.getByRole('group', { name: 'Earlier versions' });
		const firstRow = models.getByTestId('chat-model-option').first();
		await expect(firstRow).toBeVisible();
		await expect(earlier).toHaveCount(0);

		const filter = page.getByRole('textbox', { name: 'Find models' });
		const box = await firstRow.boundingBox();
		if (!box) throw new Error('The first model row has no box');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await filter.focus();
		await filter.fill('4.5');
		await expect(models.getByTestId('chat-model-option')).toHaveCount(0);
		await filter.fill('');
		await expect.poll(() => firstRow.evaluate((row) => row.matches(':hover'))).toBe(true);
		await expect(filter).toBeFocused();

		await filter.fill('opus');
		await expect(earlier.getByTestId('chat-model-version')).toHaveText([
			/^Opus 4\.8\s*May 2026/u,
			/^Opus 4\.5\s*Nov 2025/u,
		]);
		await expect(models.getByTestId('chat-model-option')).toHaveText([/^Opus/u]);
		await captureFlow(app, 'provider-models-claude-versions');

		await filter.fill('4.5');
		await expect(models.getByTestId('chat-model-option')).toHaveCount(0);
		await expect(earlier.getByTestId('chat-model-version')).toHaveText([/^Opus 4\.5/u]);
		await expect(models.getByText('No models match')).toHaveCount(0);
		await filter.press('Enter');
		await expect(models).toBeHidden();
		await expect(picker).toHaveAccessibleName('Model: Opus 4.5');

		await sendPrompt(page, 'SEARCH the fixture repo');
		await expect
			.poll(
				() => sessionEnvironments(app.home).some((entry) => entry.model === 'claude-opus-4-5'),
				{
					timeout: 30_000,
				},
			)
			.toBe(true);
		await expectAssistantReply(page);

		await picker.click();
		await expect(models.getByRole('option', { name: /^Opus 4\.5/u, selected: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();
		expectCleanConsole(app);
	} finally {
		await app.close();
		await catalog.close();
	}
});

test('a Go key lists Go and Zen models, runs each where it is sold, and checks again', async () => {
	test.setTimeout(180_000);
	const catalog = await serveModelsDev({
		opencode: {
			id: 'opencode',
			models: {
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
				'kimi-k4': catalogModel('kimi-k4', 'Kimi K4', '2026-10-20'),
				'claude-opus-5-5': {
					...catalogModel('claude-opus-5-5', 'Claude Opus 5.5', '2026-09-22'),
					family: 'claude-opus',
				},
				'claude-opus-5': {
					...catalogModel('claude-opus-5', 'Claude Opus 5', '2026-07-24'),
					family: 'claude-opus',
				},
			},
		},
		'opencode-go': {
			id: 'opencode-go',
			models: {
				'hungerg-free': {
					...catalogModel('hungerg-free', 'HungerG Free', '2026-11-24'),
					cost: { input: 0, output: 0 },
				},
				hy4: { ...catalogModel('hy4', 'Hy4', '2026-10-31'), family: 'hy' },
				'glm-6': catalogModel('glm-6', 'GLM-6', '2026-10-30'),
				hy3: { ...catalogModel('hy3', 'Hy3', '2026-07-06'), family: 'hy' },
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
				ANTHROPIC_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/opencode-go$/u),
				ANTHROPIC_AUTH_TOKEN: expect.stringMatching(LOCAL_TOKEN),
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
			'Limits on the way. Probably',
		);
		await page.mouse.move(10, 10);
		await expect(panel).toBeHidden();

		probe.report({ percent: 96 });
		await trigger.hover();
		await expect(trigger).toHaveAccessibleName(/5-hour limit 96% used/u);
		await expect(page.getByTestId('session-plan-limit-alert')).toHaveText('96% used');
		await expect(panel.getByTestId('session-opencode-usage')).toBeVisible();
		await expect(panel).not.toContainText('Limits on the way. Probably');
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
		await expect(modelOptions(page, 'opencode')).toHaveText([
			/^HungerG Free/u,
			/^Hy4/u,
			/^GLM-6/u,
			/^Kimi K4/u,
		]);
		const models = page.getByRole('listbox', { name: 'Models' });
		await expect(
			models.getByRole('group', { name: 'On Console credits' }).getByTestId('chat-model-option'),
		).toHaveText([/^Kimi K4/u]);
		const filter = page.getByRole('textbox', { name: 'Find models' });
		await filter.fill('hy');
		await expect(
			models.getByRole('group', { name: 'Earlier versions' }).getByTestId('chat-model-version'),
		).toHaveText([/^Hy3\s*Jul 2026/u]);
		await captureFlow(app, 'provider-models-opencode-go-earlier-versions');
		await filter.fill('opus');
		await expect(
			models.locator('[data-testid="chat-model-version"][data-provider="opencode"]'),
		).toHaveText([/^Opus 5\s*Credits\s*Jul 2026/u]);
		await models.getByRole('option', { name: /^Opus 5\.5/u }).hover();
		await expect(page.getByRole('listbox', { name: 'Opus 5.5 runs on' })).toBeVisible();
		await expect(runner(page, 'opencode')).toContainText('Console credits');
		await captureFlow(app, 'provider-models-opencode-go-console-credits');
		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();

		await chooseModel(page, 'opencode', 'kimi-k4');
		await sendPrompt(page, 'SEARCH the fixture repo again');
		await expect
			.poll(
				() =>
					sessionEnvironments(app.home).find((entry) => entry.model === 'kimi-k4')?.env[
						'ANTHROPIC_BASE_URL'
					] ?? '',
			)
			.toMatch(/^http:\/\/127\.0\.0\.1:\d+\/opencode$/u);

		await page.evaluate(() => {
			location.hash = '#/settings/providers';
		});
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible({ timeout: 20_000 });
		const card = page.getByTestId('provider-opencode');
		await expect(card).toHaveAttribute('data-key-saved', 'true');
		await expect(card).toContainText('Key saved. Your Go plan.');
		await expect(card.getByRole('list', { name: 'OpenCode models' })).toHaveText(
			/HungerG Free\s*Hy4\s*GLM-6\s*Kimi K4\s*Opus 5\.5\s*Opus 5\s*Hy3/u,
		);
		await captureFlow(app, 'provider-models-opencode-go-settings');

		probe.answer(403);
		await card.getByRole('button', { name: 'Check again' }).click();
		await expect(card).toContainText('API key saved on this Mac.');
		await expect(card.getByRole('list', { name: 'OpenCode models' })).toHaveText(
			/GLM-6\s*Kimi K4\s*Opus 5\.5\s*Opus 5/u,
		);
		await captureFlow(app, 'provider-models-opencode-go-checked-again');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await catalog.close();
		await probe.close();
	}
});
