import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { holdAgentRuns, seedWorkstreamOnFakeGithub } from './fake-github';
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

const AUTHOR = ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e'];

async function commitManifest(repo: string): Promise<void> {
	writeFileSync(join(repo, 'package.json'), '{ "name": "kennel", "version": "1.0.0" }\n');
	writeFileSync(
		join(repo, 'package-lock.json'),
		'{ "name": "kennel", "lockfileVersion": 3, "packages": {} }\n',
	);
	await git(repo, ['add', '.']);
	await git(repo, [...AUTHOR, 'commit', '-m', 'add manifest']);
}

async function otherWorkstream(page: Page, workstreamId: string): Promise<string> {
	let other: string | undefined;
	await expect
		.poll(
			async () => {
				const workstreams = await invoke<{ id: string }[]>(
					page,
					'repositories.list-workstreams',
					undefined,
				);
				other = workstreams.find(({ id }) => id !== workstreamId)?.id;
				return other;
			},
			{ timeout: 20_000 },
		)
		.toBeDefined();
	if (!other) throw new Error('the agent did not start a workstream');
	return other;
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

test('a workstream an agent starts opens on a chat that gets its prompt once it is set up', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'Fetch command' } });
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-starts-workstream',
			'Planner',
		);
		const kennel = await createSourceRepo(app.root, 'kennel');
		await commitManifest(kennel);
		const kennelName = `${basename(app.root)}/kennel`;
		const release = holdNpmInstall(app);
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await openWorkstream(page, workstreamId);

		agentCalls(app, { tool: 'repositories_clone', input: { repository: `file://${kennel}` } });
		await allowOnce(page, `Clone ‘file://${kennel}’`);
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: kennelName, prompt: 'Add a fetch command to kennel' },
		});
		await sendPrompt(page, 'MALINI_TOOL');

		const started = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-repository-full-name="${kennelName}"]`,
		);
		await expect(
			started.getByRole('status', { name: 'Workstream status: Setting up' }),
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByRole('group', { name: 'Permission decision' })).toHaveCount(0);
		await captureFlow(app, 'agent-workstream-setting-up');

		const startedId = await started.getAttribute('data-workstream-id');
		const sessions = await invoke<{ id: string; origin: string }[]>(page, 'chat.list-sessions', {
			workstreamId: startedId,
		});
		expect(sessions.map(({ origin }) => origin)).toEqual(['user']);
		await started.click();
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(sessions[0]?.id);
		await expect(page.getByTestId('chat-agent-tab')).toHaveCount(1);
		const install = page.getByTestId('workstream-dependency-install');
		await expect(install).toContainText('Installing dependencies · npm ci', { timeout: 20_000 });
		await captureFlow(app, 'agent-workstream-opened');

		const transcript = page.getByTestId('transcript-pane');
		await expect(transcript.getByText('Add a fetch command to kennel')).toHaveCount(0);

		writeFileSync(release, '');
		await expect(
			transcript.getByText('Add a fetch command to kennel', { exact: true }),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(transcript.getByText('Hello from the fake bridge', { exact: true })).toBeVisible({
			timeout: 30_000,
		});
		await expect(install).toHaveCount(0);
		await expect(
			started.getByRole('status', { name: /^Workstream status: (Ready|Idle)/u }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByTestId('chat-agent-tabs').getByRole('tab', { name: 'Fetch command' }),
		).toHaveText('Fetch command', { timeout: 20_000 });
		await expect(started).toContainText('Fetch command');
		await captureFlow(app, 'agent-workstream-prompt-sent');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream an agent starts from a release tag stays on that release once it is set up', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-agent-starts-from-tag',
			'Planner',
		);
		const kennel = await createSourceRepo(app.root, 'kennel');
		await git(kennel, ['tag', '-a', 'v0.17.5', '-m', 'release']);
		const release = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: kennel }).toString().trim();
		writeFileSync(join(kennel, 'unreleased.txt'), 'unreleased\n');
		await git(kennel, ['add', '.']);
		await git(kennel, ['commit', '-m', 'unreleased work']);
		const kennelName = `${basename(app.root)}/kennel`;
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await openWorkstream(page, workstreamId);

		agentCalls(app, { tool: 'repositories_clone', input: { repository: `file://${kennel}` } });
		await allowOnce(page, `Clone ‘file://${kennel}’`);
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: kennelName, prompt: 'Fix the release', base: 'v0.17.5' },
		});
		await sendPrompt(page, 'MALINI_TOOL');

		const started = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-repository-full-name="${kennelName}"]`,
		);
		await expect(
			started.getByRole('status', { name: /^Workstream status: (Ready|Idle)/u }),
		).toBeVisible({ timeout: 30_000 });
		const startedId = await started.getAttribute('data-workstream-id');
		const workstreams = await invoke<{ id: string; path: string; baseBranch: string }[]>(
			page,
			'repositories.list-workstreams',
			undefined,
		);
		const checkout = workstreams.find(({ id }) => id === startedId);
		expect(checkout?.baseBranch).toBe('main');
		expect(
			execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout?.path }).toString().trim(),
		).toBe(release);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Merge from the chat that started a workstream waits for its first turn, then merges and archives it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'Fetch command' } });
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-agent-merges-workstream',
			null,
			({ basePath }) => commitManifest(basePath),
		);
		const release = holdNpmInstall(app);
		await openWorkstream(page, 'e2e-agent-merges-workstream');

		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: 'e2e/hutch', prompt: 'EDIT:fetch.txt COMMIT=feat: add a fetch command' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		const startedId = await otherWorkstream(page, 'e2e-agent-merges-workstream');
		const started = page.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${startedId}"]`,
		);
		await expect(
			started.getByRole('status', { name: 'Workstream status: Setting up' }),
		).toBeVisible({ timeout: 20_000 });

		agentCalls(app, { tool: 'jobs_run', input: { job: 'Merge', workstream: startedId } });
		await sendPrompt(page, 'MALINI_TOOL');
		await expect(page.getByRole('heading', { name: 'Run job ‘Merge’' })).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'agent-merge-approval');
		await page
			.getByRole('group', { name: 'Permission decision' })
			.getByRole('button', { name: 'Allow once' })
			.click();
		const tray = page.getByRole('region', { name: 'Jobs (1)', exact: true });
		const queued = tray.getByRole('button', {
			name: /^Merge job in .+, Queued\. The transcript opens once the job starts$/u,
		});
		await expect(queued).toBeVisible({ timeout: 20_000 });
		await expect(page.getByRole('article', { name: /^Job Merge/u })).toHaveCount(0);
		await page.waitForTimeout(3_000);
		await expect(queued).toBeVisible();
		await captureFlow(app, 'agent-merge-waits-for-setup');

		holdAgentRuns(app, true);
		writeFileSync(release, '');
		await expect
			.poll(() => invoke(page, 'chat.workstream-has-working-run', { workstreamId: startedId }), {
				timeout: 30_000,
			})
			.toBe(true);
		const named = tray.getByRole('button', {
			name: 'Merge job in Fetch command, Queued. The transcript opens once the job starts',
		});
		await expect(named).toBeVisible({ timeout: 20_000 });
		await page.waitForTimeout(2_000);
		await expect(named).toBeVisible();
		await captureFlow(app, 'agent-merge-waits-for-turn');

		holdAgentRuns(app, false);
		await expect(tray).toHaveCount(0, { timeout: 30_000 });
		await expect
			.poll(
				async () =>
					(
						await invoke<{ title: string; status: string }[]>(page, 'jobs.list-runs', undefined)
					).find(({ title }) => title === 'Merge')?.status,
			)
			.toBe('succeeded');
		await expect.poll(() => github.pullRequest(), { timeout: 60_000 }).not.toBeNull();
		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await expect(
			page
				.getByRole('list', { name: 'Recently archived' })
				.locator(`[data-testid="sidebar-archived-workstream"][data-workstream-id="${startedId}"]`),
		).toContainText('Fetch command', { timeout: 90_000 });
		await expect(started).toHaveCount(0);
		expect(github.pullRequest()).toMatchObject({
			state: 'MERGED',
			isDraft: false,
			title: 'feat: add a fetch command',
		});
		await expect(page.getByRole('article', { name: /^Job Merge/u })).toHaveCount(0);
		await captureFlow(app, 'agent-merge-merged');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
