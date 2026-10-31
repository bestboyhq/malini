import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	GITHUB_REPOSITORIES_FIXTURE,
	PULL_REQUEST_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	listProjects,
	type WorkstreamRow,
} from './harness';

test('cloning picks a recent GitHub repository and opens its scratchpad', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'hutch');
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{
					full_name: 'e2e/hutch',
					clone_url: `file://${source}`,
					description: 'Where the rabbits live.',
				},
				{
					full_name: 'e2e/burrow',
					clone_url: 'https://github.com/e2e/burrow.git',
					description: null,
				},
			]),
		);

		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await page.getByRole('button', { name: 'Clone a GitHub repository' }).click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		const url = dialog.getByLabel('Repository URL');
		const search = dialog.getByLabel('Search repositories');
		const submit = dialog.getByRole('button', { name: 'Clone repo' });
		await expect(search).toBeFocused();
		await expect(submit).toBeDisabled();

		const recent = dialog.getByRole('list', { name: 'Recent repositories' });
		await expect(recent.getByRole('button')).toHaveCount(2);
		await page.keyboard.type('rabbit');
		await expect(recent.getByRole('button')).toHaveCount(1);
		const hutch = recent.getByRole('button', { name: /e2e\/hutch/ });
		await hutch.click();
		await expect(hutch).toHaveAttribute('aria-pressed', 'true');
		await expect(url).toHaveValue(`file://${source}`);
		await expect(submit).toBeEnabled();
		await captureFlow(app, 'clone-repository-dialog');

		await page.keyboard.press('Meta+Enter');
		await expectScratchpadOf(page, 'hutch');
		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId('sidebar-workstream')).toHaveCount(0);
		await expect
			.poll(async () => (await listProjects(page)).some((project) => project.id.endsWith('hutch')))
			.toBe(true);
		await captureFlow(app, 'clone-repository-scratchpad');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('cloning a repository opens your own pull requests in it as workstreams', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_TITLE: 'OAuth sign-in' } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'warren');
		await git(source, ['checkout', '-q', '-b', 'feat/oauth']);
		writeFileSync(join(source, 'oauth.txt'), 'oauth\n');
		await git(source, ['add', 'oauth.txt']);
		await git(source, ['commit', '-qm', 'Add OAuth sign-in']);
		await git(source, ['checkout', '-q', 'main']);
		const headRefOid = execFileSync('git', ['-C', source, 'rev-parse', 'feat/oauth'], {
			encoding: 'utf8',
		}).trim();
		writeFileSync(
			join(app.home, PULL_REQUEST_FIXTURE),
			JSON.stringify({
				title: 'feat(auth): add OAuth sign-in with refresh tokens and a remember-me option',
				headRefName: 'feat/oauth',
				headRefOid,
				baseRefName: 'main',
				isCrossRepository: false,
			}),
		);
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{ full_name: 'e2e/warren', clone_url: `file://${source}`, description: null },
			]),
		);

		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await page.getByRole('button', { name: 'Clone a GitHub repository' }).click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		await dialog.getByRole('button', { name: /e2e\/warren/u }).click();
		await dialog.getByRole('button', { name: 'Clone repo' }).click();
		await expectScratchpadOf(page, 'warren');

		const workstream = page.getByTestId('sidebar-workstream').filter({ hasText: 'OAuth sign-in' });
		await expect(workstream).toBeVisible({ timeout: 30_000 });
		await captureFlow(app, 'clone-repository-own-pull-request');
		await workstream.click();
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
		const workstreams = await invoke<WorkstreamRow[]>(
			page,
			'repositories.list-workstreams',
			undefined,
		);
		expect(workstreams.map(({ name, branch }) => ({ name, branch }))).toEqual([
			{ name: 'OAuth sign-in', branch: 'feat/oauth' },
		]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function expectScratchpadOf(page: Page, repository: string): Promise<void> {
	await expect(page.getByTestId('repository-page')).toBeVisible({ timeout: 30_000 });
	await expect(
		page.getByRole('textbox', { name: new RegExp(`^Scratchpad for .*${repository}$`, 'u') }),
	).toBeVisible();
	await expect(page).toHaveURL(/#\/repositories\//u);
}
