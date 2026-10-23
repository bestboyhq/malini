import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const SERVERS = [
	{ name: 'codebase-memory-mcp', status: 'connected', source: 'user', toolCount: 14 },
	{ name: 'plugin:productivity:linear', status: 'needs-auth', source: 'plugin' },
	{ name: 'plugin:productivity:datadog', status: 'needs-auth', source: 'plugin' },
	{ name: 'claude.ai Gmail', status: 'failed', source: 'claudeai', error: 'Connection closed' },
	{ name: 'claude.ai Google Calendar', status: 'connected', source: 'claudeai', toolCount: 9 },
	{ name: 'plugin:productivity:google-calendar', status: 'needs-auth', source: 'plugin' },
];

function claudeHome(): { root: string; settingsFile: string } {
	const root = mkdtempSync(join(tmpdir(), 'malini-e2e-'));
	const settingsFile = join(root, 'home', '.claude', 'settings.json');
	mkdirSync(join(root, 'home', '.claude'), { recursive: true });
	writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }, null, 2));
	return { root, settingsFile };
}

async function captureOpenedUrls(app: LaunchedApp): Promise<() => Promise<string[]>> {
	await app.electronApp.evaluate(({ shell }) => {
		const opened: string[] = [];
		Reflect.set(globalThis, '__openedUrls', opened);
		shell.openExternal = async (url) => {
			opened.push(url);
		};
	});
	return () =>
		app.electronApp.evaluate(() => {
			const opened: unknown = Reflect.get(globalThis, '__openedUrls');
			return Array.isArray(opened) ? opened.map(String) : [];
		});
}

function deniedServers(settingsFile: string): unknown {
	return JSON.parse(readFileSync(settingsFile, 'utf8')).deniedMcpServers ?? [];
}

function liveSwitches(commandLog: string): unknown[] {
	let lines: string[];
	try {
		lines = readFileSync(commandLog, 'utf8').split('\n').filter(Boolean);
	} catch {
		return [];
	}
	return lines
		.map((line): unknown => JSON.parse(line))
		.flatMap((command) =>
			isRecord(command) && command['cmd'] === 'switch_mcp_server'
				? [{ serverName: command['serverName'], on: command['on'], folders: command['folders'] }]
				: [],
		);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

async function openMcpSettings(page: LaunchedApp['page']): Promise<Locator> {
	await page.getByTestId('sidebar-open-settings').click();
	await page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: 'MCP servers' })
		.click();
	return page.getByRole('region', { name: 'MCP servers' });
}

test('the MCP panel groups servers by their fix, and Fix walks them one after another', async () => {
	test.setTimeout(180_000);
	const { root, settingsFile } = claudeHome();
	const app = await launchMalini({
		profile: root,
		env: {
			FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS),
			FAKE_BRIDGE_MCP_STUCK: JSON.stringify(['claude.ai Gmail']),
		},
	});
	try {
		const { page } = app;
		const openedUrls = await captureOpenedUrls(app);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-mcp-fix-ws', 'MCP fix');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		const panel = page.getByRole('dialog', { name: 'MCP server status' });
		await expect(panel.getByTestId('session-mcp-ready-count')).toHaveText('2 of 6 ready');
		await expect(
			panel.getByRole('region', { name: 'Sign in' }).getByTestId('session-mcp-display-name'),
		).toHaveText(['Linear', 'Datadog']);
		await expect(panel.getByRole('region', { name: 'Reconnect on claude.ai' })).toContainText(
			'Gmail',
		);
		const duplicates = panel.getByRole('region', { name: 'Duplicates' });
		await expect(duplicates).toContainText('Google Calendar');
		await expect(duplicates).toContainText('productivity');
		await captureFlow(app, 'mcp-panel');

		await panel.getByRole('button', { name: 'Fix 3 MCP servers' }).click();
		const fix = page.getByRole('dialog', { name: 'Fix MCP servers' });
		await expect(fix.getByRole('progressbar', { name: 'MCP servers done' })).toHaveAttribute(
			'aria-valuenow',
			'2',
		);
		await expect
			.poll(openedUrls)
			.toEqual([
				'https://auth.example.test/plugin:productivity:linear',
				'https://auth.example.test/plugin:productivity:datadog',
			]);
		await expect(fix.getByRole('alert')).toContainText('Connection closed');
		await expect(fix.getByRole('region', { name: 'Gmail' })).toContainText(
			'reconnect Gmail on claude.ai',
		);
		await captureFlow(app, 'mcp-fix-claude-ai');

		await fix.getByRole('button', { name: 'Skip' }).click();
		await expect(fix.getByRole('heading', { name: 'Done' })).toBeVisible();
		await expect(fix.getByTestId('mcp-fix-summary')).toHaveText('2 fixed · 1 skipped');
		await fix.getByRole('button', { name: 'Close' }).last().click();
		await expect(fix).toBeHidden();

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		await expect(panel.getByTestId('session-mcp-ready-count')).toHaveText('4 of 6 ready');
		await panel.getByRole('button', { name: 'Turn off Google Calendar' }).click();
		await expect
			.poll(() => deniedServers(settingsFile))
			.toEqual([{ serverName: 'plugin:productivity:google-calendar' }]);
		await expect(panel.getByTestId('session-mcp-ready-count')).toHaveText('4 of 5 ready');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings lists MCP servers by where they come from, signs in, and turns one off', async () => {
	test.setTimeout(180_000);
	const { root, settingsFile } = claudeHome();
	const app = await launchMalini({
		profile: root,
		env: { FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS) },
	});
	try {
		const { page } = app;
		const openedUrls = await captureOpenedUrls(app);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-mcp-settings', 'MCP');
		await openWorkstream(page, workstreamId);
		await page.getByTestId('sidebar-open-settings').click();
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'MCP servers' })
			.click();
		const settings = page.getByRole('region', { name: 'MCP servers' });
		await expect(settings.getByRole('region')).toHaveText([
			/^claude\.ai connectors/u,
			/^Plugin · productivity/u,
			/^Your servers/u,
		]);
		await expect(settings.getByRole('button', { name: 'Fix 3 MCP servers' })).toBeVisible();
		await captureFlow(app, 'mcp-settings');

		await settings.getByRole('button', { name: 'Sign in to Linear' }).click();
		await expect.poll(openedUrls).toEqual(['https://auth.example.test/plugin:productivity:linear']);
		const linear = settings.locator('[data-mcp-server-id="plugin:productivity:linear"]');
		await expect(linear).toHaveAttribute('data-mcp-status', 'connected');
		await expect(linear).toContainText('2 tools');

		await settings.getByRole('switch', { name: 'MCP server Datadog' }).click();
		await expect
			.poll(() => deniedServers(settingsFile))
			.toEqual([{ serverName: 'plugin:productivity:datadog' }]);
		await settings.getByRole('button', { name: /^Off/u }).click();
		await expect(settings.getByRole('heading', { level: 4 })).toHaveText(['Datadog']);

		await page.getByRole('button', { name: 'Close settings' }).click();
		await page.getByTestId('sidebar-open-settings').click();
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'MCP servers' })
			.click();
		await expect(
			settings.locator('[data-mcp-server-id="plugin:productivity:datadog"]'),
		).toHaveAttribute('data-mcp-status', 'off');
		await settings.getByRole('switch', { name: 'MCP server Datadog' }).click();
		await expect.poll(() => deniedServers(settingsFile)).toEqual([]);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('skipping a sign-in in Fix stops waiting for it', async () => {
	test.setTimeout(180_000);
	const { root } = claudeHome();
	const app = await launchMalini({
		profile: root,
		env: {
			FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS.slice(0, 3)),
			FAKE_BRIDGE_MCP_SIGN_IN_DELAY_MS: '1500',
		},
	});
	try {
		const { page } = app;
		await captureOpenedUrls(app);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-mcp-skip-ws', 'MCP skip');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		const panel = page.getByRole('dialog', { name: 'MCP server status' });
		await panel.getByRole('button', { name: 'Fix 2 MCP servers' }).click();
		const fix = page.getByRole('dialog', { name: 'Fix MCP servers' });
		await expect(fix.getByRole('status')).toContainText('Waiting for Linear');
		await fix.getByRole('button', { name: 'Skip' }).click();
		await expect(fix.getByRole('status')).toContainText('Waiting for Datadog');
		await expect(fix.getByTestId('mcp-fix-summary')).toHaveText('1 fixed · 1 skipped');
		await fix.getByRole('button', { name: 'Close' }).last().click();

		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		await expect(
			panel.getByRole('region', { name: 'Sign in' }).getByTestId('session-mcp-display-name'),
		).toHaveText(['Linear']);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a switch reaches the Claude Code of an open chat at once and is undone where it was off', async () => {
	test.setTimeout(180_000);
	const { root } = claudeHome();
	const commandLog = join(root, 'mcp-commands.jsonl');
	const app = await launchMalini({
		profile: root,
		env: {
			FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS),
			FAKE_BRIDGE_MCP_COMMAND_LOG: commandLog,
		},
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-mcp-live-ws', 'MCP live');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check the servers');
		await expectAssistantReply(page);
		const settings = await openMcpSettings(page);
		const memory = settings.getByRole('switch', { name: 'MCP server Codebase Memory' });

		await memory.click();
		await expect
			.poll(() => liveSwitches(commandLog))
			.toEqual([{ serverName: 'codebase-memory-mcp', on: false, folders: [] }]);
		await expect(settings.locator('[data-mcp-server-id="codebase-memory-mcp"]')).toHaveAttribute(
			'data-mcp-status',
			'off',
		);
		await expect(settings.getByRole('region', { name: 'Your servers' })).toContainText(
			'Codebase Memory',
		);

		await memory.click();
		await expect
			.poll(() => liveSwitches(commandLog))
			.toEqual([
				{ serverName: 'codebase-memory-mcp', on: false, folders: [] },
				{
					serverName: 'codebase-memory-mcp',
					on: true,
					folders: [expect.stringContaining(workstreamId)],
				},
			]);
		await page.getByRole('button', { name: 'Close settings' }).click();
		await page.getByRole('button', { name: 'View MCP server status' }).hover();
		await expect(
			page
				.getByRole('dialog', { name: 'MCP server status' })
				.getByTestId('session-mcp-ready-count'),
		).toHaveText('2 of 6 ready');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings shows the MCP servers it saw last time at once after a relaunch', async () => {
	test.setTimeout(180_000);
	const { root } = claudeHome();
	const first = await launchMalini({
		profile: root,
		env: { FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS) },
	});
	let workstreamId: string;
	try {
		const { page } = first;
		const source = await createSourceRepo(first.root);
		({ workstreamId } = await seedWorkstream(page, source, 'e2e-mcp-cache-ws', 'MCP cache'));
		await openWorkstream(page, workstreamId);
		const settings = await openMcpSettings(page);
		await expect(settings.locator('[data-mcp-server-id]')).toHaveCount(SERVERS.length);
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({
		profile: root,
		env: {
			FAKE_BRIDGE_MCP_SERVERS: JSON.stringify(SERVERS),
			FAKE_BRIDGE_MCP_WATCH_DELAY_MS: '600000',
		},
	});
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId);
		const settings = await openMcpSettings(page);

		await expect(settings.locator('[data-mcp-server-id]')).toHaveCount(SERVERS.length);
		await expect(settings.locator('[data-mcp-server-id="codebase-memory-mcp"]')).toHaveAttribute(
			'data-mcp-status',
			'connected',
		);
		await expect(settings.getByRole('button', { name: 'Check MCP servers again' })).toBeDisabled();
		await captureFlow(app, 'mcp-settings-cached');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
