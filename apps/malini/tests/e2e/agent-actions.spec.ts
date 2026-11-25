import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openAutomations,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
	openSettingsFromMenu,
} from './harness';
import { startFakeApi } from './fake-api';
import { seedWorkstreamOnFakeGithub } from './fake-github';

const OPEN_DRAFT = { tool: 'automations_run', input: { automation: 'Open draft' } };

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

function decision(page: Page) {
	return page.getByRole('group', { name: 'Permission decision' });
}

function settled(page: Page, text: string) {
	return page.getByRole('status').filter({ hasText: text });
}

test('an agent runs the Open draft automation once the user allows it, the draft opens after its turn ends, and the next run pushes to it unasked', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-agent-draft', null);
		await openWorkstream(page, 'e2e-agent-draft');
		agentCalls(app, OPEN_DRAFT);

		await sendPrompt(page, 'EDIT:alpha.txt MALINI_TOOL COMMIT=feat: add alpha');
		await expect(page.getByRole('heading', { name: 'Run automation ‘Open draft’' })).toBeVisible({
			timeout: 20_000,
		});
		const chatSessionId = currentSessionId(page);
		expect(chatSessionId).not.toBeNull();
		await expect(decision(page).getByRole('button', { name: 'Always allow' })).toBeVisible();
		await captureFlow(app, 'agent-open-draft-asks');
		await decision(page).getByRole('button', { name: 'Allow once' }).click();

		await expect(settled(page, 'Allowed once')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Run automation ‘Open draft’' })).toBeVisible();
		await captureFlow(app, 'agent-open-draft-allowed');
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		expect(github.pullRequest()).toMatchObject({ isDraft: true, title: 'feat: add alpha' });
		expect(github.pushedSubjects()).toEqual(['feat: add alpha', 'seed']);

		await sendPrompt(page, 'EDIT:beta.txt MALINI_TOOL COMMIT=fix: add beta');
		await expect
			.poll(() => github.pushedSubjects(), { timeout: 30_000 })
			.toEqual(['fix: add beta', 'feat: add alpha', 'seed']);
		await expect(decision(page)).toHaveCount(0);
		await expect(settled(page, 'Allowed once')).toHaveCount(1);
		expect(github.pullRequest()).toMatchObject({ isDraft: true });
		const transcript = page.getByTestId('transcript-pane');
		for (const file of ['alpha.txt', 'beta.txt']) {
			await expect(
				transcript.getByRole('button', { name: `Show current changes to ${file}`, exact: true }),
			).toBeVisible();
		}
		await expect(
			transcript.getByLabel('Show input and output for Run automation ‘Open draft’', {
				exact: true,
			}),
		).toHaveCount(1);
		await captureFlow(app, 'agent-open-draft-pushes-unasked');

		await openAutomations(page, '#/automations/activity');
		const activity = page.getByTestId('automations-activity');
		const draftRuns = activity.getByTestId('automation-run-row').filter({ hasText: 'Open draft' });
		await expect(draftRuns).toHaveCount(2, { timeout: 20_000 });
		await expect(draftRuns.first()).toContainText('Started by an agent');
		const turns = activity.getByTestId('chat-turn-row');
		await expect(turns).toHaveCount(2);
		await expect(turns.first()).toContainText('Chat');
		for (const turn of await turns.all()) {
			await turn.getByRole('button', { name: /^Show 1 call in / }).click();
		}
		const calls = activity.getByTestId('agent-action-row');
		await expect(calls).toHaveCount(2);
		await expect(calls.nth(0)).toContainText('Run automation ‘Open draft’');
		await expect(calls.nth(0)).not.toContainText('You ');
		await expect(calls.nth(1)).toContainText('Run automation ‘Open draft’');
		await expect(calls.nth(1)).toContainText('You allowed it');
		await expect(activity.getByRole('button', { name: /transcript opens/u })).toHaveCount(0);
		await captureFlow(app, 'agent-open-draft-activity');
		await draftRuns
			.first()
			.getByRole('link', { name: /^Open chat: Open draft · .+ · Started by an agent, Done$/u })
			.click();
		await expect.poll(() => currentSessionId(page)).toBe(chatSessionId);
		await expect(transcript).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Allow everywhere stops asking in every workstream until the user revokes it in Settings', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-allow-everywhere', null);
		const other = await seedWorkstream(
			page,
			await createSourceRepo(app.root, 'other'),
			'e2e-allow-elsewhere',
			'Elsewhere',
		);
		await openWorkstream(page, 'e2e-allow-everywhere');
		agentCalls(app, OPEN_DRAFT);

		await sendPrompt(page, 'EDIT:alpha.txt MALINI_TOOL');
		await decision(page).getByRole('button', { name: 'Always allow' }).click();
		await expect(page.getByRole('menu', { name: 'Always allow' })).toBeVisible();
		await captureFlow(app, 'agent-actions-always-allow-menu');
		await page
			.getByRole('menu', { name: 'Always allow' })
			.getByRole('menuitem', { name: 'Allow everywhere' })
			.click();
		await expect(settled(page, 'Allowed everywhere')).toBeVisible({ timeout: 20_000 });

		await openWorkstream(page, other.workstreamId);
		await sendPrompt(page, 'EDIT:beta.txt MALINI_TOOL');
		await expect(page.getByText('Hello from the fake bridge', { exact: true })).toBeVisible({
			timeout: 30_000,
		});
		await expect(decision(page)).toHaveCount(0);

		await openSettingsFromMenu(page);
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Agent access', exact: true })
			.click();
		const grants = page.getByRole('list', { name: 'Always allowed' });
		await expect(grants.getByRole('listitem')).toHaveCount(1);
		await expect(grants.getByRole('listitem')).toContainText('Run ‘Open draft’');
		await expect(grants.getByRole('listitem')).toContainText('Everywhere');
		await captureFlow(app, 'agent-actions-always-allowed');
		await grants.getByRole('button', { name: 'Revoke Run ‘Open draft’' }).click();
		await expect(grants).toHaveCount(0);
		await expect(page.getByText('Nothing yet.', { exact: false })).toBeVisible();
		await page.keyboard.press('Escape');

		await startFreshChat(page);
		await sendPrompt(page, 'EDIT:gamma.txt MALINI_TOOL');
		await expect(decision(page)).toBeVisible({ timeout: 20_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an agent adds an MCP server once the user always allows it, shows env names but not values, and adds the next one without asking', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-mcp-servers',
			'MCP chores',
		);
		await openWorkstream(page, workstreamId);
		const grip = '/Applications/Grip.app/Contents/Resources/grip-mcp';
		agentCalls(app, {
			tool: 'mcp_servers_add',
			input: { name: 'grip', command: grip, args: ['--stdio'], env: { GRIP_TOKEN: 'grip-1234' } },
		});

		await sendPrompt(page, 'MALINI_TOOL');
		await expect(page.getByRole('heading', { name: 'Add MCP server ‘grip’' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByText(`${grip} --stdio`, { exact: true })).toBeVisible();
		await expect(page.getByText('GRIP_TOKEN', { exact: true })).toBeVisible();
		await expect(page.getByText('Every chat and claude in your terminal')).toBeVisible();
		await expect(page.getByText('grip-1234')).toHaveCount(0);
		await captureFlow(app, 'agent-mcp-server-asks');
		await decision(page).getByRole('button', { name: 'Always allow' }).click();
		await page
			.getByRole('menu', { name: 'Always allow' })
			.getByRole('menuitem', { name: 'Allow everywhere' })
			.click();
		await expect(settled(page, 'Allowed everywhere')).toBeVisible({ timeout: 20_000 });

		agentCalls(app, {
			tool: 'mcp_servers_add',
			input: { name: 'linear', url: 'https://mcp.linear.app/mcp' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		await expect
			.poll(
				async () =>
					(await listEvents(page, currentSessionId(page) ?? '')).filter(
						({ event }) =>
							event.type === 'tool.completed' && event.name === 'mcp__malini__mcp_servers_add',
					).length,
				{ timeout: 20_000 },
			)
			.toBe(2);
		await expect(decision(page)).toHaveCount(0);

		await openAutomations(page, '#/automations/activity');
		const activity = page.getByTestId('automations-activity');
		const turns = activity.getByTestId('chat-turn-row');
		await expect(turns).toHaveCount(2, { timeout: 20_000 });
		for (const turn of await turns.all()) {
			await turn.getByRole('button', { name: /^Show 1 call in / }).click();
		}
		const calls = activity.getByTestId('agent-action-row');
		await expect(calls).toHaveCount(2);
		await expect(calls.nth(0)).toContainText('Add MCP server ‘linear’');
		await expect(calls.nth(1)).toContainText('Add MCP server ‘grip’');
		for (const call of await calls.all()) await expect(call).toContainText('Always allowed');

		await openSettingsFromMenu(page);
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Agent access', exact: true })
			.click();
		const grants = page.getByRole('list', { name: 'Always allowed' });
		await expect(grants.getByRole('listitem')).toHaveCount(1);
		await expect(grants.getByRole('listitem')).toContainText('Add MCP servers');
		await captureFlow(app, 'agent-mcp-server-always-allowed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an agent saves a widget that reads an API without asking, it lands on the board with its author, and Activity names it', async () => {
	test.setTimeout(120_000);
	const api = await startFakeApi({});
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-widgets',
			'Widget chores',
		);
		await openWorkstream(page, workstreamId);
		const source = {
			http: {
				url: `${api.url}/api/projects/1/query/`,
				method: 'POST',
				body: { query: { kind: 'TrendsQuery' } },
				oauth: { scopes: ['query:read'] },
			},
		};
		agentCalls(app, {
			tool: 'widgets_save',
			input: {
				id: 'rooms',
				title: 'Rooms',
				icon: 'users',
				source,
				refresh: { every: 60 },
			},
		});

		await sendPrompt(page, 'MALINI_TOOL');
		const saved = async () =>
			(await listEvents(page, currentSessionId(page) ?? '')).flatMap(({ event }) =>
				event.type === 'tool.completed' && event.name === 'mcp__malini__widgets_save'
					? [String(event.output)]
					: [],
			);
		await expect.poll(saved, { timeout: 20_000 }).toHaveLength(1);
		await expect(decision(page)).toHaveCount(0);
		const [output = ''] = await saved();
		expect(JSON.parse(output)).toMatchObject({
			widget: { id: 'rooms', title: 'Rooms', author: 'e2e-user', origin: 'mine' },
			reading: { widgetId: 'rooms' },
		});
		const board = await invoke<WidgetBoard>(page, 'widgets.board', { workstreamId });
		expect(board.placements[0]).toEqual({ widgetId: 'rooms', span: { columns: 2, rows: 1 } });
		expect(existsSync(join(worktree, '.malini'))).toBe(false);
		await captureFlow(app, 'agent-widget-saved');

		await openAutomations(page, '#/automations/activity');
		const activity = page.getByTestId('automations-activity');
		await activity
			.getByTestId('chat-turn-row')
			.getByRole('button', { name: /^Show 1 call in / })
			.click({ timeout: 20_000 });
		const call = activity.getByTestId('agent-action-row');
		await expect(call).toContainText('Save widget ‘Rooms’');
		await expect(call).not.toContainText('allowed');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await api.close();
	}
});

test('an agent edit to an automation that runs on its own waits for a review of each change, and Save keeps exactly what the user kept', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-automation-review',
			'Automation review',
		);
		const automation = await invoke<{ id: string }>(page, 'automations.save-definition', {
			name: 'Release notes',
			instructions: 'Read the merged pull requests.\nGroup them.\nWrite the notes.\nPost them.',
			model: 'opus',
			effort: 'high',
			runsIn: 'workstream',
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
		});
		agentCalls(app, {
			tool: 'automations_save',
			input: {
				id: automation.id,
				model: 'sonnet',
				instructions:
					'Read the merged pull requests.\nGroup them by area.\nWrite the notes.\nPost them to main.\nPush to main.',
			},
		});
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'MALINI_TOOL');
		await expect(
			page.getByRole('heading', {
				name: 'Review Claude’s changes to the automation ‘Release notes’',
			}),
		).toBeVisible({ timeout: 20_000 });
		await expect(decision(page)).toHaveCount(0);
		const editor = page.getByRole('textbox', { name: 'Instructions' });
		await expect(page.getByRole('button', { name: 'Accept change' })).toHaveCount(2);
		await captureFlow(app, 'agent-automation-edit-review');

		await page.getByRole('button', { name: 'Reject Model' }).click();
		await expect(page.getByRole('listitem', { name: 'Model change' })).toContainText('Rejected');
		await page.getByRole('button', { name: 'Reject change' }).last().click();
		await page.getByRole('button', { name: 'Accept change' }).first().click();
		await expect(page.getByRole('button', { name: 'Accept change' })).toHaveCount(0);
		await editor.click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type('\nThank the authors.');
		await page
			.getByRole('group', { name: 'Review decision' })
			.getByRole('button', { name: 'Save' })
			.click();

		await expect(settled(page, 'Saved after review')).toBeVisible({ timeout: 20_000 });
		await expect
			.poll(async () => {
				const events = await listEvents(page, currentSessionId(page) ?? '');
				const saved = events.find(
					({ event }) =>
						event.type === 'tool.completed' && event.name === 'mcp__malini__automations_save',
				);
				return saved?.event.type === 'tool.completed' ? String(saved.event.output) : '';
			})
			.toContain('The user reviewed your change');
		await expect
			.poll(async () => {
				const definitions = await invoke<{ id: string; model: string; instructions: string }[]>(
					page,
					'automations.list-definitions',
					undefined,
				);
				return definitions.find((definition) => definition.id === automation.id);
			})
			.toMatchObject({
				model: 'opus',
				instructions:
					'Read the merged pull requests.\nGroup them by area.\nWrite the notes.\nPost them.\nThank the authors.',
			});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an agent clones a repository, starts and archives a workstream in it without asking, hides it, and Activity shows every call with its outcome', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'Fetch' } });
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-repositories',
			'Repository chores',
		);
		const kennel = await createSourceRepo(app.root, 'kennel');
		const kennelName = `${basename(app.root)}/kennel`;
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await openWorkstream(page, workstreamId);

		async function allowOnce(heading: string, prompt = 'MALINI_TOOL'): Promise<void> {
			await sendPrompt(page, prompt);
			await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20_000 });
			await decision(page).getByRole('button', { name: 'Allow once' }).click();
			await expect(settled(page, 'Allowed once').last()).toBeVisible({ timeout: 20_000 });
		}

		agentCalls(app, { tool: 'repositories_clone', input: { repository: `file://${kennel}` } });
		await allowOnce(`Clone ‘file://${kennel}’`);
		await expect
			.poll(
				async () =>
					(await invoke<{ fullName: string }[]>(page, 'repositories.list-clones')).map(
						(repository) => repository.fullName,
					),
				{ timeout: 20_000 },
			)
			.toContain(kennelName);
		await expect(sidebar.getByRole('link', { name: `Open ${kennelName}` })).toBeVisible();

		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: kennelName, prompt: 'Add a fetch command' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		const fetchRow = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-repository-full-name="${kennelName}"]`,
		);
		await expect(fetchRow).toHaveAccessibleName(/ Fetch$/u, { timeout: 20_000 });
		await expect(sidebar.getByRole('list', { name: /^Started by / })).toHaveCount(0);
		writeFileSync(join(worktree, 'chores.txt'), 'chores\n');
		const choresRow = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
		);
		await expect(choresRow.getByTestId('sidebar-workstream-change-totals')).toHaveAccessibleName(
			'1 additions, 0 deletions',
			{ timeout: 20_000 },
		);
		await expect(page.getByRole('heading', { name: /^Started here/u })).toHaveCount(0);

		agentCalls(app, { tool: 'workstreams_archive', input: { workstream: 'Fetch' } });
		await sendPrompt(page, 'MALINI_TOOL');
		await expect(fetchRow).toHaveCount(0, { timeout: 30_000 });
		await expect(
			page.getByTestId('sidebar-archived-workstream').filter({ hasText: 'Fetch' }),
		).toHaveCount(1);
		await expect(decision(page)).toHaveCount(0);

		agentCalls(app, { tool: 'repositories_hide', input: { repository: kennelName } });
		await allowOnce(`Hide ‘${kennelName}’`);
		await expect
			.poll(async () => (await invoke<string[]>(page, 'repositories.list-hidden')).length, {
				timeout: 20_000,
			})
			.toBe(1);
		await expect(sidebar.getByRole('link', { name: `Open ${kennelName}` })).toHaveCount(0);

		await openAutomations(page, '#/automations/activity');
		const activity = page.getByTestId('automations-activity');
		const turns = activity.getByTestId('chat-turn-row');
		await expect(turns).toHaveCount(4, { timeout: 20_000 });
		const calls = activity.getByTestId('agent-action-row');
		await expect(calls).toHaveCount(0);
		for (let index = 0; index < 4; index += 1) {
			await turns
				.nth(index)
				.getByRole('button', { name: /^Show 1 call in / })
				.click();
		}
		await expect(calls).toHaveCount(4);
		await expect(calls.nth(0)).toContainText(`Hide ‘${kennelName}’`);
		await expect(calls.nth(0)).toContainText('You allowed it');
		await expect(calls.nth(1)).toContainText('Archive ‘Fetch’');
		await expect(calls.nth(1)).not.toContainText('You ');
		await expect(calls.nth(2)).toContainText(`Start a workstream in ‘${kennelName}’`);
		await expect(calls.nth(2)).not.toContainText('You ');
		await expect(calls.nth(3)).toContainText(`Clone ‘file://${kennel}’`);
		await calls
			.nth(2)
			.getByRole('button', { name: `Start a workstream in ‘${kennelName}’, Done` })
			.click();
		await expect(calls.nth(2)).toContainText('Called with');
		await expect(calls.nth(2)).toContainText('"prompt": "Add a fetch command"');
		await expect(calls.nth(2)).toContainText(`"repository": "${kennelName}"`);
		await expect(calls.nth(2).getByRole('link', { name: 'Open chat' })).toBeVisible();
		await captureFlow(app, 'agent-actions-activity');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
