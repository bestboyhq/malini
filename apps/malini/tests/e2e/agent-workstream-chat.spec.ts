import { chmodSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

async function allowOnce(page: Page, heading: string): Promise<void> {
	await sendPrompt(page, 'MALINI_TOOL');
	await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20_000 });
	await page
		.getByRole('group', { name: 'Permission decision' })
		.getByRole('button', { name: 'Allow once' })
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Allowed once' }).last()).toBeVisible({
		timeout: 20_000,
	});
}

function holdNpmInstall(app: LaunchedApp): string {
	const release = join(app.home, 'npm-release');
	const stub = join(app.bin, 'npm');
	writeFileSync(
		stub,
		`#!/bin/sh\nwhile [ ! -f "${release}" ]; do sleep 0.1; done\nmkdir -p node_modules\n`,
	);
	chmodSync(stub, 0o755);
	return release;
}

test('a workstream an agent starts shows Setting up and its install, and opens on its own chat', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-starts-workstream',
			'Planner',
		);
		const kennel = await createSourceRepo(app.root, 'kennel');
		writeFileSync(join(kennel, 'package.json'), '{ "name": "kennel", "version": "1.0.0" }\n');
		writeFileSync(
			join(kennel, 'package-lock.json'),
			'{ "name": "kennel", "lockfileVersion": 3, "packages": {} }\n',
		);
		await git(kennel, ['add', '.']);
		await git(kennel, ['commit', '-m', 'add manifest']);
		const kennelName = `${basename(app.root)}/kennel`;
		const release = holdNpmInstall(app);
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await openWorkstream(page, workstreamId);

		agentCalls(app, { tool: 'repositories_clone', input: { repository: `file://${kennel}` } });
		await allowOnce(page, `Clone ‘file://${kennel}’`);
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: kennelName, name: 'Fetch' },
		});
		await allowOnce(page, `Start a workstream in ‘${kennelName}’`);

		const fetch = sidebar
			.locator('[data-testid="sidebar-workstream"]')
			.filter({ hasText: 'Fetch' });
		await expect(fetch.getByRole('status', { name: 'Workstream status: Setting up' })).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'agent-workstream-setting-up');

		const fetchId = await fetch.getAttribute('data-workstream-id');
		const sessions = await invoke<{ id: string; origin: string }[]>(page, 'chat.list-sessions', {
			workstreamId: fetchId,
		});
		expect(sessions.map(({ origin }) => origin)).toEqual(['user']);
		await fetch.click();
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(sessions[0]?.id);
		await expect(page.getByTestId('chat-agent-tab')).toHaveCount(1);
		const install = page.getByTestId('workstream-dependency-install');
		await expect(install).toContainText('Installing dependencies · npm ci', { timeout: 20_000 });
		await captureFlow(app, 'agent-workstream-opened');

		writeFileSync(release, '');
		await expect(fetch.getByRole('status', { name: 'Workstream status: Idle' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(install).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
