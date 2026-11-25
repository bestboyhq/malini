import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SavedSecret } from '../../src/contract/secrets';
import type { WidgetBoard } from '../../src/contract/widgets';
import { startFakeApi, type FakeApi } from './fake-api';
import { seedWorkstreamOnFakeGithub } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	listSessions,
	launchMalini,
	openWorkstream,
	promptsOf,
	seedWorkstream,
	sendPrompt,
} from './harness';

const OPEN_ROOMS = { value: 5, unit: 'rooms', caption: 'open now' };

function rooms(api: FakeApi): Readonly<{ http: Readonly<{ url: string }> }> {
	return { http: { url: `${api.url}/rooms` } };
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

test('a widget the agent saves lands first on the board at two by one, where its API reads, and the chat card removes it', async () => {
	test.setTimeout(120_000);
	const api = await startFakeApi({ '/rooms': OPEN_ROOMS });
	const app = await launchMalini();
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
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: rooms(api) },
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const card = page.getByRole('region', { name: 'Rooms widget' });
		await expect(card.getByText('On your board')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('open now');
		await expect(card).toContainText(`GET ${api.site}/rooms`);
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('open now', {
			timeout: 20_000,
		});
		expect(api.requests.map(({ method, path }) => `${method} ${path}`)).toContain('GET /rooms');
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
		await api.close();
	}
});

test('a widget whose key is missing asks for it on its tile, links to where to get one, and reads once it is saved', async () => {
	test.setTimeout(120_000);
	const api = await startFakeApi({
		'/rooms': { value: 8, caption: 'open now' },
	});
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-widget-key',
			'Widget key',
		);
		await openWorkstream(page, workstreamId);
		const source = {
			http: {
				url: `${api.url}/rooms`,
				headers: { authorization: 'Bearer ${ROOMS_KEY}' },
				keyUrl: `${api.url}/keys`,
			},
		};
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
		await expect(tile).toContainText(`Needs ROOMS_KEY. Malini sends it only to ${api.site}.`, {
			timeout: 20_000,
		});
		const save = tile.getByRole('button', { name: 'Save' });
		await expect(save).toBeDisabled();
		expect(api.requests).toEqual([]);
		await captureFlow(app, 'widget-needs-key');

		await app.electronApp.evaluate(({ shell }) => {
			const opened: string[] = [];
			Reflect.set(globalThis, '__openedUrls', opened);
			shell.openExternal = async (url) => {
				opened.push(url);
			};
		});
		await tile.getByRole('button', { name: 'Get a key' }).click();
		await expect
			.poll(() =>
				app.electronApp.evaluate(() => {
					const opened: unknown = Reflect.get(globalThis, '__openedUrls');
					return Array.isArray(opened) ? opened.map(String) : [];
				}),
			)
			.toEqual([`${api.url}/keys`]);

		await tile.getByLabel('ROOMS_KEY').fill('rk_live_8f2a');
		await save.click();
		await expect(tile).toContainText('open now', { timeout: 20_000 });
		await expect(tile.getByLabel('ROOMS_KEY')).toHaveCount(0);
		expect(
			api.requests.flatMap(({ path, headers }) =>
				path === '/rooms' ? [headers.authorization] : [],
			),
		).toEqual(['Bearer rk_live_8f2a']);
		expect(
			(await invoke<SavedSecret[]>(page, 'secrets.list', undefined)).map(({ name }) => name),
		).toEqual(['ROOMS_KEY']);
		await captureFlow(app, 'widget-key-saved');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await api.close();
	}
});

test('Make default copies your widget into this workstream and asks this chat, and New widget asks this chat or, with ⌘, a new one', async () => {
	test.setTimeout(150_000);
	const api = await startFakeApi({ '/rooms': OPEN_ROOMS });
	const app = await launchMalini();
	try {
		const workstreamId = 'e2e-widget-default';
		const { page, worktree } = await seedWorkstreamOnFakeGithub(app, workstreamId, null);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: rooms(api) },
			}),
		);
		await sendPrompt(page, 'MALINI_TOOL');
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('open now', {
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
		await api.close();
	}
});
