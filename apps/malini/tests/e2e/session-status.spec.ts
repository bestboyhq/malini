import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('the MCP panel shows the live status of the chat servers when it opens', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-mcp-status-ws',
			'MCP status workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		const panel = page.getByRole('dialog', { name: 'MCP server status' });
		await expect(panel.getByRole('listitem')).toHaveText(['Fs']);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the MCP panel signs in to a server that needs it and retries one that failed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: {
			FAKE_BRIDGE_MCP_SERVERS: JSON.stringify([
				{ name: 'fs', status: 'connected' },
				{ name: 'linear', status: 'needs-auth' },
				{ name: 'sentry', status: 'failed', error: 'connection refused' },
			]),
		},
	});
	try {
		const { page } = app;
		await app.electronApp.evaluate(({ shell }) => {
			const opened: string[] = [];
			Reflect.set(globalThis, '__openedUrls', opened);
			shell.openExternal = async (url) => {
				opened.push(url);
			};
		});
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-mcp-actions-ws',
			'MCP actions workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		const panel = page.getByRole('dialog', { name: 'MCP server status' });
		const signIn = panel.getByRole('button', { name: 'Sign in to Linear' });
		const retry = panel.getByRole('button', { name: 'Retry Sentry' });

		await signIn.click();
		await expect
			.poll(() =>
				app.electronApp.evaluate(() => {
					const opened: unknown = Reflect.get(globalThis, '__openedUrls');
					return Array.isArray(opened) ? opened.map(String) : [];
				}),
			)
			.toEqual(['https://auth.example.test/linear']);
		await expect(signIn).toBeHidden();

		await retry.click();
		await expect(retry).toBeHidden();
		await expect(panel.getByRole('button')).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the composer status cards follow the pointer and ignore clicks', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-status-click-ws',
			'Status click workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);

		const mcpTrigger = page.getByRole('button', { name: 'View MCP server status' });
		const mcpPanel = page.getByRole('dialog', { name: 'MCP server status' });
		await mcpTrigger.click();
		await expect(mcpPanel).toBeVisible();
		await mcpTrigger.click();
		await expect(mcpPanel).toBeVisible();

		const contextPanel = page.getByRole('dialog', { name: 'Context and plan usage' });
		await page.getByRole('button', { name: /^View context and plan usage/u }).hover();
		await expect(contextPanel).toBeVisible();
		await expect(mcpPanel).toBeHidden();

		await page.getByTestId('chat-composer-submit').hover();
		await expect(contextPanel).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the context panel shows what the chat holds now, not what it held when the last turn ended', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: {
			FAKE_BRIDGE_USAGE: JSON.stringify({ contextTokens: 40_000, contextWindowTokens: 200_000 }),
			FAKE_BRIDGE_REFRESHED_CONTEXT: JSON.stringify({
				contextTokens: 90_000,
				contextWindowTokens: 200_000,
				providerMetrics: {
					anthropic: {
						contextCategories: [
							{ name: 'System prompt', tokens: 10_000, kind: 'used' },
							{ name: 'Messages', tokens: 80_000, kind: 'used' },
							{ name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
						],
						rateLimits: [{ label: '5-hour limit', utilization: 60, resetsAt: null }],
						observedAt: new Date().toISOString(),
						account: 'e2e@example.com',
					},
				},
			}),
		},
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-context-status-ws',
			'Context status workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Read the whole repository');
		await expectAssistantReply(page);

		const trigger = page.getByRole('button', { name: /^View context and plan usage/u });
		await expect(trigger).toHaveAccessibleName(
			'View context and plan usage, 20% of the context window used',
		);

		await trigger.hover();
		const panel = page.getByRole('dialog', { name: 'Context and plan usage' });
		await expect(trigger).toHaveAccessibleName(
			'View context and plan usage, 45% of the context window used',
		);
		await expect(panel.getByRole('term')).toHaveText([
			'Messages',
			'System prompt',
			'Autocompact buffer',
			'Free space',
		]);
		await expect(panel.getByRole('definition')).toHaveText([
			'80K',
			'40.0%',
			'10K',
			'5.0%',
			'33K',
			'16.5%',
			'77K',
			'38.5%',
		]);
		await expect(panel.getByRole('progressbar', { name: '5-hour limit used' })).toHaveAttribute(
			'aria-valuenow',
			'60',
		);
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
