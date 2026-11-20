import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	GITHUB_REPOSITORIES_FIXTURE,
	PULL_REQUEST_FIXTURE,
	captureFlow,
	connectFolder,
	createSourceRepo,
	expectCleanConsole,
	ghCalls,
	git,
	invoke,
	launchMalini,
	openRepositoriesPage,
	expectPicker,
	listProjects,
	type WorkstreamRow,
} from './harness';

test('cloning searches your GitHub repositories in the command center, reading your login once, and opens the page of the pick', async () => {
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

		await expectPicker(page);
		await connectFolder(app, 'pasture');
		await openRepositoriesPage(page);
		await expect.poll(() => signInReadDone(ghCalls(app.home))).toBe(true);
		const opened = ghCalls(app.home).length;
		await page.getByRole('button', { name: 'Find a repository' }).click();
		const dialog = page.getByRole('dialog', { name: 'Command center' });
		const search = dialog.getByRole('combobox', { name: 'Search repositories' });
		await expect(search).toBeFocused();
		await expect(search).toHaveAttribute('placeholder', 'Search 3 repositories or paste a URL');

		const found = dialog.getByRole('listbox', { name: 'Your repositories' });
		await expect(found.getByRole('option')).toHaveCount(3);
		await expect.poll(() => signInReadDone(ghCalls(app.home).slice(opened))).toBe(true);
		await page.waitForTimeout(1_000);
		expect(
			ghCalls(app.home)
				.slice(opened)
				.filter((call) => call === LOGIN),
		).toHaveLength(1);
		await page.keyboard.type('rabbit');
		await expect(found.getByRole('option')).toHaveCount(1);
		const hutch = found.getByRole('option', { name: /e2e\/hutch/ });
		await expect(hutch).toHaveAttribute('aria-selected', 'true');
		await captureFlow(app, 'clone-repository-dialog');

		await page.keyboard.press('Enter');
		await expectRepositoryPageOf(page, 'hutch');
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

test('a cloned repository lists your open pull requests only behind its Pull requests button, reads them as it opens, and Continue here opens one on its own branch', async () => {
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
				number: 12,
				url: 'https://github.com/e2e/warren/pull/12',
				isDraft: false,
				updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
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

		await expectPicker(page);
		await connectFolder(app, 'pasture');
		await openRepositoriesPage(page);
		await page.getByRole('button', { name: 'Find a repository' }).click();
		await page
			.getByRole('dialog', { name: 'Command center' })
			.getByRole('option', { name: /e2e\/warren/u })
			.click();
		await expectRepositoryPageOf(page, 'warren');

		const title = 'feat(auth): add OAuth sign-in with refresh tokens and a remember-me option';
		const button = page
			.getByTestId('repository-page')
			.getByRole('button', { name: 'Pull requests', exact: true });
		const list = page.getByRole('dialog', { name: 'Your open pull requests' });
		const continueHere = list.getByRole('button', { name: `Continue ${title} here` });
		await expect(button).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
		await page.waitForTimeout(2_000);
		await expect(list).toHaveCount(0);
		expect(ownPullRequestReads(app.home)).toBe(0);

		await button.click();
		await expect(continueHere).toBeVisible({ timeout: 30_000 });
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		await page.waitForTimeout(2_000);
		expect(ownPullRequestReads(app.home)).toBe(1);
		await expect(page.getByTestId('sidebar-workstream')).toHaveCount(0);
		expect(await repositoryWorkstreams(page)).toEqual([]);
		await continueHere.hover();
		await captureFlow(app, 'repository-own-pull-requests');

		await continueHere.click();
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByTestId('sidebar-workstream').filter({ hasText: 'OAuth sign-in' }),
		).toHaveAttribute('aria-current', 'page');
		const workstreams = await repositoryWorkstreams(page);
		expect(workstreams.map(({ name, branch }) => ({ name, branch }))).toEqual([
			{ name: 'OAuth sign-in', branch: 'feat/oauth' },
		]);
		await page.getByTestId('sidebar-connected-repository').filter({ hasText: 'warren' }).click();
		await button.click({ timeout: 30_000 });
		await expect(list.getByRole('button', { name: `Open ${title}` })).toBeVisible({
			timeout: 30_000,
		});
		await page.keyboard.press('Escape');
		await expect(list).toHaveCount(0);
		await expect(button).toBeFocused();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

const LOGIN = 'api user --jq .login';

function ownPullRequestReads(home: string): number {
	return ghCalls(home).filter((call) => call.startsWith('pr list --author @me')).length;
}

function signInReadDone(calls: readonly string[]): boolean {
	const asked = calls.lastIndexOf('auth status');
	return asked !== -1 && calls.lastIndexOf(LOGIN) > asked;
}

function repositoryWorkstreams(page: Page): Promise<WorkstreamRow[]> {
	return invoke<WorkstreamRow[]>(page, 'repositories.list-workstreams', undefined);
}

async function expectRepositoryPageOf(page: Page, repository: string): Promise<void> {
	await expect(
		page
			.getByTestId('repository-page')
			.getByRole('heading', { level: 1, name: new RegExp(`${repository}$`, 'u') }),
	).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/#\/repositories\//u);
}
