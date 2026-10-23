import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
} from './harness';
import { seedWorkstreamOnFakeGithub } from './fake-github';

const OPEN_DRAFT = { tool: 'pull_requests_open_draft', input: {} };

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

function decision(page: Page) {
	return page.getByRole('group', { name: 'Permission decision' });
}

function settled(page: Page, text: string) {
	return page.getByRole('status').filter({ hasText: text });
}

test('an agent opens a draft pull request once the user allows it, after its turn ends', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-agent-draft', null);
		await openWorkstream(page, 'e2e-agent-draft');
		agentCalls(app, OPEN_DRAFT);

		await sendPrompt(page, 'EDIT:alpha.txt MALINI_TOOL COMMIT=feat: add alpha');
		await expect(page.getByRole('heading', { name: 'Open a draft pull request' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(decision(page).getByRole('button', { name: 'Always allow' })).toBeVisible();
		await captureFlow(app, 'agent-open-draft-asks');
		await decision(page).getByRole('button', { name: 'Allow once' }).click();

		await expect(settled(page, 'Allowed once')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		expect(github.pullRequest()).toMatchObject({ isDraft: true, title: 'feat: add alpha' });
		expect(github.pushedSubjects()).toEqual(['feat: add alpha', 'seed']);
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

		await page.getByTestId('sidebar-open-settings').click();
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Agent access', exact: true })
			.click();
		const grants = page.getByRole('list', { name: 'Always allowed' });
		await expect(grants.getByRole('listitem')).toHaveCount(1);
		await expect(grants.getByRole('listitem')).toContainText('Open draft pull requests');
		await expect(grants.getByRole('listitem')).toContainText('Everywhere');
		await captureFlow(app, 'agent-actions-always-allowed');
		await grants.getByRole('button', { name: 'Revoke Open draft pull requests' }).click();
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

test('an agent edit to a job that runs on its own waits for a review of each change, and Save keeps exactly what the user kept', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-job-review', 'Job review');
		const job = await invoke<{ id: string }>(page, 'jobs.save-definition', {
			name: 'Release notes',
			instructions: 'Read the merged pull requests.\nGroup them.\nWrite the notes.\nPost them.',
			model: 'opus',
			effort: 'high',
			runsIn: 'workstream',
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
		});
		agentCalls(app, {
			tool: 'jobs_save',
			input: {
				id: job.id,
				model: 'sonnet',
				instructions:
					'Read the merged pull requests.\nGroup them by area.\nWrite the notes.\nPost them to main.\nPush to main.',
			},
		});
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'MALINI_TOOL');
		await expect(
			page.getByRole('heading', { name: 'Review Claude’s changes to the job ‘Release notes’' }),
		).toBeVisible({ timeout: 20_000 });
		await expect(decision(page)).toHaveCount(0);
		const editor = page.getByRole('textbox', { name: 'Instructions' });
		await expect(page.getByRole('button', { name: 'Accept change' })).toHaveCount(2);
		await captureFlow(app, 'agent-job-edit-review');

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
					({ event }) => event.type === 'tool.completed' && event.name === 'mcp__malini__jobs_save',
				);
				return saved?.event.type === 'tool.completed' ? String(saved.event.output) : '';
			})
			.toContain('The user reviewed your change');
		await expect
			.poll(async () => {
				const definitions = await invoke<{ id: string; model: string; instructions: string }[]>(
					page,
					'jobs.list-definitions',
					undefined,
				);
				return definitions.find((definition) => definition.id === job.id);
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
