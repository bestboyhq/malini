import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	type LaunchedApp,
	launchMalini,
	openWorkstream,
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

test('a widget whose MCP server is not added says so, and Add starts a workstream that adds it', async () => {
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

		await tile.getByRole('button', { name: 'Add rooms-db' }).click();
		await expect(page).not.toHaveURL(new RegExp(workstreamId), { timeout: 20_000 });
		await expect(
			page.getByText(
				/Add the rooms-db MCP server at https:\/\/rooms\.example\.test\/mcp with mcp_servers_add, so my Rooms widget can read its/,
			),
		).toBeVisible({ timeout: 20_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
