import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import {
	PULL_REQUEST_FIXTURE,
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	expectStoppedChatIsNeutral,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
	type SeededWorkstream,
} from './harness';

const execFileAsync = promisify(execFile);
const GITHUB_URL = 'https://github.com/e2e/hutch.git';
const OFFLINE_PROXY = 'http://127.0.0.1:9';
const COMMIT_AND_PUSH = 'Commit and push changes #1';
const OFFLINE_PUSH_FAILURES = [
	/repositories\.push-workstream GitError: Couldn't reach github\.com\./u,
	/toast Pull request action failed · Couldn't reach github\.com\./u,
];

test('the top bar holds Commit and push while the workstream agent is still running', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedPublishedWorkstream(app, 'e2e-agent-running-ws');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'EDIT:a.txt HANG');
		await expectRunEdited(page, 'a.txt');
		const waiting = page.getByRole('button', { name: 'Waiting for the agent to finish' });
		await expect(waiting).toBeDisabled({ timeout: 20_000 });
		await expect(page.getByRole('button', { name: COMMIT_AND_PUSH })).toHaveCount(0);
		await captureFlow(app, 'commit-and-push-agent-running');
		const detail = page.getByRole('button', { name: 'Pull request #1 detail' });
		await expect(detail).toBeEnabled();
		await detail.click();
		await expect(page.getByRole('dialog', { name: 'Pull request #1 detail' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Pull request #1 detail' })).toHaveCount(0);

		await page.getByTestId('chat-composer-submit').click();
		await expect(page.getByRole('button', { name: COMMIT_AND_PUSH })).toBeEnabled({
			timeout: 20_000,
		});
		await expect(waiting).toHaveCount(0);
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat did not commit a session id');
		await expectStoppedChatIsNeutral(page, sessionId);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Commit and push never reuses the commit line of an already committed run', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: OFFLINE_PUSH_FAILURES });
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedPublishedWorkstream(app, 'e2e-stale-commit-ws');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'EDIT:a.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await commitAndPush(page);
		await expect
			.poll(() => subjects(worktree), { timeout: 20_000 })
			.toEqual(['feat: add alpha', 'seed']);

		await sendPrompt(page, 'EDIT:b.txt HANG');
		await expectRunEdited(page, 'b.txt');
		await page.getByTestId('chat-composer-submit').click();
		await commitAndPush(page);
		await expect.poll(() => subjects(worktree), { timeout: 20_000 }).toHaveLength(3);
		expect(await subjects(worktree)).toEqual(['EDIT:b.txt HANG', 'feat: add alpha', 'seed']);
		await captureFlow(app, 'commit-and-push-fresh-subject');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Commit and push never takes a one-word reply as the commit subject', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: OFFLINE_PUSH_FAILURES });
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedPublishedWorkstream(app, 'e2e-done-subject-ws');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		await commitAndPush(page);
		await expect
			.poll(() => subjects(worktree), { timeout: 20_000 })
			.toEqual(['EDIT:a.txt', 'seed']);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the top bar, the Files panel and the sidebar count the same changes', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId, worktree } = await seedPublishedWorkstream(app, 'e2e-changed-count-ws');
		const junk = join(worktree, 'build-output', 'chunks');
		mkdirSync(junk, { recursive: true });
		for (let index = 0; index < 1_200; index += 1) {
			writeFileSync(join(junk, `${index}-${'0'.repeat(120)}.js`), 'x\n');
		}
		await openWorkstream(page, workstreamId);

		const changed = page.getByRole('button', { name: 'Filter to files with uncommitted changes' });
		const sidebarRow = page.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
		);
		await expect(changed).toHaveText(/^Changed\s*1$/u, { timeout: 20_000 });
		await expectCommitAndPushTooltip(page, 'Commit and push 1 changed file');
		await expect(sidebarRow.getByTestId('sidebar-workstream-changed-files')).toHaveText('1 file');
		await changed.click();
		const files = await page.evaluate((count) => new Intl.NumberFormat().format(count), 1_200);
		await expect(
			page.getByRole('treeitem', {
				name: `build-output/, untracked directory of ${files} files, too large to show changes`,
			}),
		).toBeVisible();
		await captureFlow(app, 'commit-and-push-untracked-tree');
		await page.getByRole('button', { name: 'Remove the changed files filter' }).click();

		mkdirSync(join(worktree, 'notes'));
		writeFileSync(join(worktree, 'notes', 'scratch.txt'), 'hello\n');
		writeFileSync(join(worktree, 'notes', 'todo.txt'), 'todo\n');
		writeFileSync(join(worktree, 'seed.txt'), 'seed\nedited\n');
		await expect(changed).toHaveText(/^Changed\s*4$/u, { timeout: 20_000 });
		await expectCommitAndPushTooltip(page, 'Commit and push 4 changed files');
		await expect(sidebarRow.getByTestId('sidebar-workstream-change-totals')).toHaveAccessibleName(
			'3 additions, 0 deletions',
			{ timeout: 20_000 },
		);
		await captureFlow(app, 'commit-and-push-changed-count');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function expectCommitAndPushTooltip(page: Page, tooltip: string): Promise<void> {
	const action = page.getByRole('button', { name: COMMIT_AND_PUSH });
	await expect(action).toBeEnabled({ timeout: 20_000 });
	await action.hover();
	await expect(page.getByRole('tooltip')).toHaveText(tooltip, { timeout: 20_000 });
	await page.mouse.move(0, 0);
}

async function seedPublishedWorkstream(
	app: LaunchedApp,
	workstreamId: string,
): Promise<SeededWorkstream> {
	const source = await createSourceRepo(app.root);
	writeFileSync(
		join(app.home, '.gitconfig'),
		`[user]\n\tname = e2e\n\temail = e2e@example.com\n[http]\n\tproxy = ${OFFLINE_PROXY}\n`,
	);
	writeFileSync(
		join(app.home, PULL_REQUEST_FIXTURE),
		JSON.stringify({
			number: 1,
			state: 'OPEN',
			isDraft: false,
			title: 'Hutch',
			url: 'https://github.com/e2e/hutch/pull/1',
			headRefName: `malini/${workstreamId}`,
			baseRefName: 'main',
			headRefOid: null,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			reviewDecision: null,
			statusCheckRollup: [],
			updatedAt: '2026-01-01T00:00:00Z',
		}),
	);
	const seeded = await seedWorkstream(app.page, source, workstreamId, 'Hutch');
	await execFileAsync('git', ['-C', seeded.basePath, 'remote', 'set-url', 'origin', GITHUB_URL]);
	return seeded;
}

async function expectRunEdited(page: Page, path: string): Promise<void> {
	await expect(page.getByTestId('run-activity-file').filter({ hasText: path })).toBeVisible({
		timeout: 20_000,
	});
}

async function commitAndPush(page: Page): Promise<void> {
	const action = page.getByRole('button', { name: COMMIT_AND_PUSH });
	await expect(action).toBeEnabled({ timeout: 20_000 });
	await action.click();
}

async function subjects(worktree: string): Promise<string[]> {
	const { stdout } = await execFileAsync('git', ['-C', worktree, 'log', '--format=%s']);
	return stdout.split('\n').filter((line) => line.length > 0);
}
