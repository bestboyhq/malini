import { execFile } from 'node:child_process';
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AgentActionRecord } from '../../src/contract/jobs';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const execFileAsync = promisify(execFile);

function fileTab(page: Page, name: string): Locator {
	return page.getByTestId('chat-agent-tabs').getByRole('tab', { name, exact: true });
}

function editor(page: Page, path: RegExp | string): Locator {
	return page.getByRole('textbox', { name: typeof path === 'string' ? `Edit ${path}` : path });
}

async function workstreamWithFile(app: LaunchedApp, workstreamId: string): Promise<string> {
	const source = await createSourceRepo(app.root);
	writeFileSync(join(source, 'alpha.ts'), 'export const alpha = 1;\n');
	await execFileAsync('git', ['-C', source, 'add', '.']);
	await execFileAsync('git', ['-C', source, 'commit', '-m', 'alpha']);
	const seeded = await seedWorkstream(app.page, source, workstreamId, 'Edit files workstream');
	await openWorkstream(app.page, seeded.workstreamId);
	await expect(app.page.getByRole('treeitem', { name: 'Open alpha.ts' })).toBeVisible({
		timeout: 20_000,
	});
	return seeded.worktree;
}

async function streamerMode(page: Page, mode: 'On' | 'Off', workstreamId: string): Promise<void> {
	await page.evaluate(() => {
		location.hash = '#/settings/privacy';
	});
	await page
		.getByRole('group', { name: 'Streamer mode' })
		.getByRole('button', { name: mode })
		.click();
	await openWorkstream(page, workstreamId);
}

test('a file tab is an editor that saves what the user types into the worktree, and keeps the tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const worktree = await workstreamWithFile(app, 'e2e-edit-file-ws');

		await page.getByRole('treeitem', { name: 'Open alpha.ts' }).click();
		await expect(fileTab(page, 'alpha.ts')).toHaveAccessibleDescription('Preview');
		const alpha = editor(page, 'alpha.ts');
		await expect(alpha).toContainText('export const alpha = 1;', { timeout: 20_000 });
		await alpha.getByText('export const alpha = 1;').click();
		await page.keyboard.press('End');
		await page.keyboard.type(' // checked by hand');

		const panel = page.getByRole('tabpanel', { name: 'alpha.ts' });
		await expect
			.poll(() => readFileSync(join(worktree, 'alpha.ts'), 'utf8'), { timeout: 20_000 })
			.toBe('export const alpha = 1; // checked by hand\n');
		await expect(panel.getByRole('alert')).toBeHidden();
		await expect(fileTab(page, 'alpha.ts')).not.toHaveAccessibleDescription('Preview');
		await expect(panel).toContainText('Removed: export const alpha = 1;', { timeout: 20_000 });
		await expect(panel).toContainText('Added: export const alpha = 1; // checked by hand');

		await page.keyboard.press('ControlOrMeta+z');
		await expect
			.poll(() => readFileSync(join(worktree, 'alpha.ts'), 'utf8'))
			.toBe('export const alpha = 1;\n');
		await page.keyboard.type(' // kept');
		await expect
			.poll(() => readFileSync(join(worktree, 'alpha.ts'), 'utf8'))
			.toBe('export const alpha = 1; // kept\n');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'file-editing-1-saved');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a file an agent opens in a workstream the user is not looking at waits there for them', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithFile(app, 'e2e-opens-later-ws');
		const elsewhere = await seedWorkstream(
			page,
			await createSourceRepo(app.root, 'elsewhere'),
			'e2e-elsewhere-ws',
			'Elsewhere',
		);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'files_open',
				input: { path: 'alpha.ts', line: 1 },
				releasedBy: 'open-alpha',
			}),
		);
		await sendPrompt(page, 'MALINI_UNASKED_TOOL');
		await openWorkstream(page, elsewhere.workstreamId);
		await expect(page.getByRole('treeitem', { name: 'Open seed.txt' })).toBeVisible({
			timeout: 20_000,
		});

		writeFileSync(join(app.home, 'open-alpha'), '');
		await expect
			.poll(
				async () =>
					(await invoke<AgentActionRecord[]>(page, 'jobs.list-agent-actions')).find(
						({ tool }) => tool === 'files_open',
					)?.status,
				{ timeout: 20_000 },
			)
			.toBe('succeeded');
		await expect(fileTab(page, 'alpha.ts')).toHaveCount(0);

		await openWorkstream(page, 'e2e-opens-later-ws');
		await expect(fileTab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'true', {
			timeout: 20_000,
		});
		await expect(fileTab(page, 'alpha.ts')).not.toHaveAccessibleDescription('Preview');
		await expect(editor(page, 'alpha.ts')).toContainText('export const alpha = 1;');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an agent opens a secrets file outside the worktree for the user, who fills it in beside the chat', async () => {
	test.setTimeout(240_000);
	const first = await launchMalini();
	const workstreamId = 'e2e-secrets-ws';
	const secrets = join(first.home, '.secrets', 'kennel.env');
	try {
		const { page } = first;
		await workstreamWithFile(first, workstreamId);
		writeFileSync(
			join(first.home, 'malini-tool.json'),
			JSON.stringify({ tool: 'files_open', input: { path: '~/.secrets/kennel.env' } }),
		);

		await sendPrompt(page, 'MALINI_UNASKED_TOOL');
		await expectAssistantReply(page);

		const tab = fileTab(page, 'kennel.env');
		await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
		await expect(tab).not.toHaveAccessibleDescription('Preview');
		await expect(page.getByText('This file is empty.')).toBeVisible();
		expect(statSync(secrets).mode & 0o777).toBe(0o600);
		const actions = await invoke<AgentActionRecord[]>(page, 'jobs.list-agent-actions');
		expect(actions.find(({ tool }) => tool === 'files_open')).toMatchObject({
			status: 'succeeded',
			approval: 'not-needed',
			output: JSON.stringify({ path: realpathSync(secrets), created: true }),
		});

		await editor(page, /^Edit .*kennel\.env$/u).click();
		await page.keyboard.type('KENNEL_TOKEN=pasted-by-the-user');
		const panel = page.getByRole('tabpanel', { name: 'kennel.env' });
		await expect
			.poll(() => readFileSync(secrets, 'utf8'), { timeout: 20_000 })
			.toBe('KENNEL_TOKEN=pasted-by-the-user');
		await expect(panel.getByRole('alert')).toBeHidden();
		expect(statSync(secrets).mode & 0o777).toBe(0o600);
		await page.mouse.move(0, 0);
		await captureFlow(first, 'file-editing-2-secrets-filled-in');

		await streamerMode(page, 'On', workstreamId);
		await fileTab(page, 'kennel.env').click();
		const show = panel.getByRole('button', { name: 'Show kennel.env' });
		await expect(show).toBeVisible({ timeout: 20_000 });
		await expect(panel.getByText('Hidden while your screen is shared')).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(first, 'file-editing-3-secrets-hidden-while-streaming');
		await show.click();
		await expect(show).toBeHidden();
		await streamerMode(page, 'Off', workstreamId);
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId);
		await fileTab(page, 'kennel.env').click();
		await expect(editor(page, /^Edit .*kennel\.env$/u)).toHaveText(
			'KENNEL_TOKEN=pasted-by-the-user',
			{ timeout: 20_000 },
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
