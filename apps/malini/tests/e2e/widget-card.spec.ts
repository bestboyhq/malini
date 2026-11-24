import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import { seedWorkstreamOnFakeGithub } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	listSessions,
	type LaunchedApp,
	launchMalini,
	openWorkstream,
	promptsOf,
	seedWorkstream,
	sendPrompt,
} from './harness';

const ROOMS = { mcp: { server: 'rooms-db', tool: 'count', arguments: { open: true } } };

function mcpEnv(
	status: 'connected' | 'needs-auth',
	output: string,
): Readonly<Record<string, string>> {
	const server = ROOMS.mcp.server;
	return {
		FAKE_BRIDGE_MCP_SERVERS: JSON.stringify([{ name: server, status, source: 'user' }]),
		FAKE_BRIDGE_MCP_TOOLS: JSON.stringify({
			[server]: [{ name: ROOMS.mcp.tool, readOnly: true, output }],
		}),
	};
}

async function promptInAnotherChat(
	page: Page,
	workstreamId: string,
	shown: string,
	text: RegExp,
): Promise<boolean> {
	for (const session of await listSessions(page, workstreamId)) {
		if (session.id === shown) continue;
		const prompts = await promptsOf(page, session.id);
		if (prompts.some(({ text: said }) => typeof said === 'string' && text.test(said))) return true;
	}
	return false;
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

test('a widget the agent saves lands first on the board at two by one, where its MCP tool reads, and the chat card removes it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: mcpEnv('connected', '{"value":5,"unit":"rooms","caption":"open now"}'),
	});
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-widget-card',
			'Widget card',
		);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: ROOMS },
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const card = page.getByRole('region', { name: 'Rooms widget' });
		await expect(card.getByText('On your board')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('5');
		await expect(card).toContainText('rooms-db · count');
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('5', {
			timeout: 20_000,
		});
		const placements = async () =>
			(await invoke<WidgetBoard>(page, 'widgets.board', { workstreamId })).placements;
		expect(await placements()).toEqual([{ widgetId: 'rooms', span: { columns: 2, rows: 1 } }]);
		await captureFlow(app, 'widget-card-on-board');

		await card.getByRole('button', { name: 'Remove' }).click();
		await expect(card.getByText('Removed from your board')).toBeVisible();
		await expect(board.getByRole('article', { name: /^Rooms, / })).toHaveCount(0);
		expect(await placements()).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a widget whose MCP server needs a sign-in says so, signs in from its tile, and reads once the server connects', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: mcpEnv('needs-auth', '{"value":8,"caption":"open now"}') });
	try {
		const { page } = app;
		const openedUrls = await captureOpenedUrls(app);
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-widget-sign-in',
			'Widget sign-in',
		);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: ROOMS },
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const tile = page
			.getByRole('region', { name: 'Widgets' })
			.getByRole('article', { name: 'Rooms, 2 by 1' });
		await expect(tile).toContainText('rooms-db needs you to sign in.', { timeout: 20_000 });
		await captureFlow(app, 'widget-needs-sign-in');

		await tile.getByRole('button', { name: 'Sign in to rooms-db' }).click();
		await expect.poll(openedUrls).toEqual(['https://auth.example.test/rooms-db']);
		await expect(tile).toContainText('8', { timeout: 20_000 });
		await expect(tile.getByRole('button', { name: 'Sign in to rooms-db' })).toHaveCount(0);
		const fix = page.getByRole('dialog', { name: 'Fix MCP servers' });
		await fix.getByRole('button', { name: 'Close' }).last().click();
		await expect(fix).toBeHidden();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a widget whose MCP server is not added says so, Add asks this chat to add it, and ⌘ asks a new chat', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_MCP_SERVERS: '[]', FAKE_BRIDGE_MCP_TOOLS: '{}' },
	});
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-widget-add-server',
			'Widget add server',
		);
		await openWorkstream(page, workstreamId);
		const source = { mcp: { ...ROOMS.mcp, url: 'https://rooms.example.test/mcp' } };
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source },
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const tile = page
			.getByRole('region', { name: 'Widgets' })
			.getByRole('article', { name: 'Rooms, 2 by 1' });
		await expect(tile).toContainText('rooms-db is not one of your MCP servers.', {
			timeout: 20_000,
		});
		await captureFlow(app, 'widget-needs-add');

		const shown = currentSessionId(page);
		if (shown === null) throw new Error('the chat did not commit a session id');
		const addPrompt =
			/Add the rooms-db MCP server at https:\/\/rooms\.example\.test\/mcp with mcp_servers_add, so my Rooms widget can read its/u;
		await tile.getByRole('button', { name: 'Add rooms-db' }).click();
		await expect(page.getByText(addPrompt)).toBeVisible({ timeout: 20_000 });
		expect(page.url()).toContain(workstreamId);
		expect(currentSessionId(page)).toBe(shown);

		await page.keyboard.down('Meta');
		const inNewChat = tile.getByRole('button', { name: 'Add rooms-db in a new chat' });
		await expect(inNewChat).toBeVisible();
		await captureFlow(app, 'widget-needs-add-command');
		await inNewChat.click({ modifiers: ['Meta'] });
		await page.keyboard.up('Meta');
		await expect(tile.getByRole('button', { name: 'Add rooms-db' })).toBeVisible();
		await expect
			.poll(() => promptInAnotherChat(page, workstreamId, shown, addPrompt), { timeout: 30_000 })
			.toBe(true);
		expect(currentSessionId(page)).toBe(shown);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Make default copies your widget into this workstream and asks this chat, and New widget asks this chat or, with ⌘, a new one', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini({
		env: mcpEnv('connected', '{"value":5,"unit":"rooms","caption":"open now"}'),
	});
	try {
		const workstreamId = 'e2e-widget-default';
		const { page, worktree } = await seedWorkstreamOnFakeGithub(app, workstreamId, null);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: ROOMS },
			}),
		);
		await sendPrompt(page, 'MALINI_TOOL');
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('5', {
			timeout: 20_000,
		});
		const shown = currentSessionId(page);
		if (shown === null) throw new Error('the chat did not commit a session id');

		await board.getByRole('button', { name: 'Options for Rooms' }).click();
		const menu = page.getByRole('menu');
		await page.keyboard.down('Meta');
		await expect(menu.getByRole('menuitem', { name: 'Make default in a new chat' })).toBeVisible();
		await captureFlow(app, 'widget-make-default-command');
		await page.keyboard.up('Meta');
		await menu.getByRole('menuitem', { name: 'Make default for this repository' }).click();
		await expect(
			page.getByText(/Make the "Rooms" widget a default for this repository/u),
		).toBeVisible({ timeout: 20_000 });
		expect(existsSync(join(worktree, '.malini/widgets/rooms.json'))).toBe(true);
		expect(currentSessionId(page)).toBe(shown);

		await board.getByRole('button', { name: 'New widget' }).click();
		const field = board.getByRole('textbox', { name: 'New widget' });
		await field.fill('open rooms per floor');
		await captureFlow(app, 'widget-new-field');
		await field.press('Enter');
		await expect(page.getByText('Make me a widget that shows open rooms per floor')).toBeVisible({
			timeout: 20_000,
		});
		expect(currentSessionId(page)).toBe(shown);

		await board.getByRole('button', { name: 'New widget' }).click();
		await field.fill('rooms booked today');
		await field.press('Meta+Enter');
		await expect
			.poll(
				() =>
					promptInAnotherChat(
						page,
						workstreamId,
						shown,
						/Make me a widget that shows rooms booked today/u,
					),
				{ timeout: 30_000 },
			)
			.toBe(true);
		expect(currentSessionId(page)).toBe(shown);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
