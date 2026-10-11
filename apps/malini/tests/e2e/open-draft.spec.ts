import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	expectStoppedChatIsNeutral,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import { headOf, seedWorkstreamOnFakeGithub, sidebarStatus, type FakeGithub } from './fake-github';

const OPEN_DRAFT = 'Open a draft pull request';
const QUEUE_MERGE = 'Queue merge for pull request #7';

test('Open draft commits and pushes the work under its generated title, and every later run is pushed once the workstream goes idle', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-open-draft',
			null,
		);
		await openWorkstream(page, 'e2e-open-draft');
		const status = sidebarStatus(page, 'e2e-open-draft');

		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await expect(status).toHaveAttribute('data-workstream-pull-request-state', 'none');
		const open = page.getByRole('button', { name: OPEN_DRAFT });
		await expect(open).toHaveText('Open draft', { timeout: 30_000 });
		await open.click();

		await expect(page.getByRole('button', { name: QUEUE_MERGE })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(open).toHaveCount(0);
		expect(github.pullRequest()).toMatchObject({ isDraft: true, title: 'feat: add alpha' });
		expect(pullRequestCreations(github)).toHaveLength(1);
		expect(github.pushedSubjects()).toEqual(['feat: add alpha', 'seed']);
		expect(github.pushedHead()).toBe(headOf(worktree));
		await expect(status).toHaveAttribute('data-workstream-pull-request-state', 'draft');
		await expect(status).toHaveAccessibleName(/ · Draft pull request$/u);
		await captureFlow(app, 'open-draft');

		await sendPrompt(page, 'EDIT:beta.txt');
		await expect
			.poll(() => github.pushedSubjects(), { timeout: 30_000 })
			.toEqual(['EDIT:beta.txt', 'feat: add alpha', 'seed']);
		expect(github.pushedHead()).toBe(headOf(worktree));
		expect(pullRequestCreations(github)).toHaveLength(1);
		await expect(page.getByRole('button', { name: QUEUE_MERGE })).toBeEnabled();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Open draft clicked while the agent runs waits for the run to end, then opens the draft', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-draft-waits', null);
		await openWorkstream(page, 'e2e-draft-waits');

		await sendPrompt(page, 'EDIT:a.txt HANG');
		await expectRunEdited(page, 'a.txt');
		const open = page.getByRole('button', { name: OPEN_DRAFT });
		await expect(open).toBeEnabled({ timeout: 30_000 });
		await open.click();

		const waiting = page.getByRole('button', { name: 'Waiting for the agent…' });
		await expect(waiting).toBeDisabled({ timeout: 20_000 });
		await expect(sidebarStatus(page, 'e2e-draft-waits')).toHaveAccessibleName(/Opening draft/u);
		await captureFlow(app, 'open-draft-waits-for-the-agent');
		expect(pullRequestCreations(github)).toEqual([]);

		await page.getByTestId('chat-composer-submit').click();
		await expect(page.getByRole('button', { name: QUEUE_MERGE })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(waiting).toHaveCount(0);
		expect(github.pullRequest()).toMatchObject({ isDraft: true });
		expect(github.pushedSubjects()).toEqual(['EDIT:a.txt HANG', 'seed']);
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat did not commit a session id');
		await expectStoppedChatIsNeutral(page, sessionId);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Open draft is offered while the Files panel and the sidebar count the same changes', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await seedWorkstreamOnFakeGithub(app, 'e2e-changed-count', null);
		const junk = join(worktree, 'build-output', 'chunks');
		mkdirSync(junk, { recursive: true });
		for (let index = 0; index < 1_200; index += 1) {
			writeFileSync(join(junk, `${index}-${'0'.repeat(120)}.js`), 'x\n');
		}
		await openWorkstream(page, 'e2e-changed-count');

		const changed = page.getByRole('button', { name: 'Filter to files with uncommitted changes' });
		const sidebarRow = page.locator(
			'[data-testid="sidebar-workstream"][data-workstream-id="e2e-changed-count"]',
		);
		await expect(changed).toHaveText(/^Changed\s*1$/u, { timeout: 20_000 });
		await expect(page.getByRole('button', { name: OPEN_DRAFT })).toBeEnabled({ timeout: 20_000 });
		await expect(sidebarRow.getByTestId('sidebar-workstream-changed-files')).toHaveText('1 file');
		await changed.click();
		const files = await page.evaluate((count) => new Intl.NumberFormat().format(count), 1_200);
		await expect(
			page.getByRole('treeitem', {
				name: `build-output/, untracked directory of ${files} files, too large to show changes`,
			}),
		).toBeVisible();
		await captureFlow(app, 'open-draft-untracked-tree');
		await page.getByRole('button', { name: 'Remove the changed files filter' }).click();

		mkdirSync(join(worktree, 'notes'));
		writeFileSync(join(worktree, 'notes', 'scratch.txt'), 'hello\n');
		writeFileSync(join(worktree, 'notes', 'todo.txt'), 'todo\n');
		writeFileSync(join(worktree, 'seed.txt'), 'seed\nedited\n');
		await expect(changed).toHaveText(/^Changed\s*4$/u, { timeout: 20_000 });
		await expect(sidebarRow.getByTestId('sidebar-workstream-change-totals')).toHaveAccessibleName(
			'3 additions, 0 deletions',
			{ timeout: 20_000 },
		);
		await expect(page.getByRole('button', { name: OPEN_DRAFT })).toBeEnabled();
		await captureFlow(app, 'open-draft-changed-count');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function expectRunEdited(page: Page, path: string): Promise<void> {
	await expect(page.getByTestId('run-activity-file').filter({ hasText: path })).toBeVisible({
		timeout: 20_000,
	});
}

function pullRequestCreations(github: FakeGithub): string[][] {
	return github.calls().filter(([command, sub]) => command === 'pr' && sub === 'create');
}
