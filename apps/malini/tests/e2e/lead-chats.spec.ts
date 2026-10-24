import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function transcript(page: Page) {
	return page.getByTestId('transcript-pane');
}

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

async function allowOnce(page: Page, heading: string): Promise<void> {
	await sendPrompt(page, 'MALINI_TOOL');
	await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20_000 });
	await page
		.getByRole('group', { name: 'Permission decision' })
		.getByRole('button', { name: 'Allow once' })
		.last()
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Allowed once' })).not.toHaveCount(0, {
		timeout: 20_000,
	});
}

async function startChat(page: Page, scope: 'home' | string, title: string): Promise<void> {
	const before = page.url();
	if (scope === 'home') {
		await sidebar(page).getByRole('button', { name: 'New chat', exact: true }).click();
	} else {
		const owner = sidebar(page).getByTestId('sidebar-owner-folder').filter({ hasText: scope });
		await owner.hover();
		await sidebar(page)
			.getByRole('button', { name: `New chat in ${scope}` })
			.click();
	}
	await expect.poll(() => page.url()).not.toBe(before);
	await expect(transcript(page)).toBeVisible({ timeout: 20_000 });
	await sendPrompt(page, `Plan it TITLE="${title}"`);
	await expect(sidebar(page).getByTestId('sidebar-chat').filter({ hasText: title })).toBeVisible({
		timeout: 20_000,
	});
}

async function lastReply(page: Page, text: string): Promise<void> {
	await expect(transcript(page).getByText(text, { exact: true }).last()).toBeVisible({
		timeout: 30_000,
	});
}

test('a Home chat starts workstreams in two organizations, and they fold under it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const site = await createSourceRepo(app.root, 'solo/site');
		await seedWorkstream(page, `file://${api}`, 'e2e-lead-api-work', 'Api work');
		await invoke(page, 'repositories.create-repository', { repoUrl: `file://${site}` });
		await page.reload();

		await startChat(page, 'home', 'Move apps to Logdash');
		const lead = sidebar(page)
			.getByTestId('sidebar-chat')
			.filter({ hasText: 'Move apps to Logdash' });
		await expect(lead).toHaveAttribute('aria-current', 'page');
		await expect(lead).toHaveAttribute('data-chat-scope', 'home');
		await sendPrompt(page, 'WHICH_LINEAGE');
		await lastReply(page, 'Lead: Home reads acme/api, solo/site');

		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: 'acme/api', prompt: 'WHICH_LINEAGE TITLE="Api analytics"' },
		});
		await allowOnce(page, 'Start a workstream in ‘acme/api’');
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: 'solo/site', prompt: 'WHICH_LINEAGE TITLE="Site analytics"' },
		});
		await allowOnce(page, 'Start a workstream in ‘solo/site’');

		const started = sidebar(page).getByRole('list', { name: 'Started by Move apps to Logdash' });
		const children = started.getByTestId('sidebar-workstream');
		await expect(children).toHaveCount(2, { timeout: 30_000 });
		await expect(children.filter({ hasText: 'site' })).toContainText('solo');
		await expect(lead.getByTestId('sidebar-progress')).toHaveAccessibleName(/^2 workstreams/u);
		await expect(sidebar(page).getByRole('link', { name: 'Open solo/site' })).toHaveCount(0);
		await expect(
			sidebar(page)
				.locator('[data-testid="sidebar-connected-repository"][data-full-name="acme/api"]')
				.getByText('api', { exact: true }),
		).toBeVisible();
		await expect(sidebar(page).getByTestId('sidebar-workstream')).toHaveCount(3);
		await captureFlow(app, 'lead-chat-home-sidebar');

		await children.filter({ hasText: 'site' }).click();
		await lastReply(page, 'Started by: Move apps to Logdash');
		await lastReply(page, 'Siblings: acme/api');
		await captureFlow(app, 'lead-chat-started-workstream');

		await sidebar(page)
			.getByRole('button', { name: 'Fold the workstreams of Move apps to Logdash' })
			.click();
		await expect(children.first()).toBeHidden();
		await page.mouse.move(0, 0);
		await expect(lead.getByTestId('sidebar-progress')).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an organization chat sits in its owner block, and focus narrows the sidebar to one owner', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const web = await createSourceRepo(app.root, 'acme/web');
		const site = await createSourceRepo(app.root, 'solo/site');
		await seedWorkstream(page, `file://${api}`, 'e2e-focus-api', 'Api work');
		await seedWorkstream(page, `file://${web}`, 'e2e-focus-web', 'Web work');
		await seedWorkstream(page, `file://${site}`, 'e2e-focus-site', 'Site work');
		await page.reload();

		const acme = sidebar(page).getByRole('button', { name: 'acme, 2 repositories' });
		await expect(acme).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 });
		await expect(sidebar(page).getByRole('button', { name: 'solo, 1 repository' })).toBeVisible();
		await startChat(page, 'acme', 'Unify footers');
		await expect(
			sidebar(page).getByRole('button', { name: 'acme, 1 chat, 2 repositories' }),
		).toBeVisible();
		await expect(
			sidebar(page)
				.getByRole('list', { name: 'Chats in acme' })
				.getByTestId('sidebar-chat')
				.filter({ hasText: 'Unify footers' }),
		).toHaveAttribute('data-chat-scope', 'owner');
		await sendPrompt(page, 'WHICH_LINEAGE');
		await lastReply(page, 'Lead: acme reads acme/api, acme/web');

		const focus = page.getByRole('group', { name: 'Focus' });
		await focus.getByRole('button', { name: 'Pin an organization or repository' }).click();
		await page.getByRole('menuitemcheckbox', { name: 'acme' }).click();
		await expect(page.getByRole('menuitemcheckbox', { name: 'acme' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await page.keyboard.press('Escape');
		await focus.getByRole('button', { name: 'acme', exact: true }).click();
		await expect(focus.getByRole('button', { name: 'acme', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(sidebar(page).getByRole('link', { name: 'Open solo/site' })).toHaveCount(0);
		await expect(sidebar(page).getByRole('button', { name: 'New chat', exact: true })).toHaveCount(
			0,
		);
		await expect(sidebar(page).getByRole('link', { name: 'Open acme/web' })).toBeVisible();
		await expect(sidebar(page).getByRole('button', { name: 'New chat in acme' })).toBeVisible();
		await captureFlow(app, 'lead-chat-focus-owner');

		await page.reload();
		await expect(focus.getByRole('button', { name: 'acme', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
			{ timeout: 20_000 },
		);
		await focus.getByRole('button', { name: 'All', exact: true }).click();
		await expect(sidebar(page).getByRole('link', { name: 'Open solo/site' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
