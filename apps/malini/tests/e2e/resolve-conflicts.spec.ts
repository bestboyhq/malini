import { execFile } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	git,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

const execFileAsync = promisify(execFile);
const GITHUB_URL = 'https://github.com/e2e/conflict.git';
const WORKSTREAM_ID = 'e2e-conflict';
const BRANCH = `malini/${WORKSTREAM_ID}`;
const AUTHOR = ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e'];

test('Resolve conflicts merges the base, the agent edits the markers away, and Commit and push lands a two-parent merge', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { source, worktree } = await openConflictingPullRequest(app);
		await resolveConflictsWithTheAgent(app);

		const commit = page.getByRole('button', { name: 'Commit and push changes #7' });
		expect(readFileSync(join(worktree, 'conflict.txt'), 'utf8')).toBe('branch line\nmain line\n');
		await expect(page.getByRole('link', { name: /Conflicting workstream/u })).toBeVisible();
		await commit.click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeVisible({
			timeout: 60_000,
		});
		await expect(page.getByRole('button', { name: 'Resolve merge conflicts #7' })).toHaveCount(0);
		const parents = (await output(worktree, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(
			' ',
		);
		expect(parents).toHaveLength(3);
		expect(await output(source, ['rev-parse', BRANCH])).toBe(parents[0]);
		await captureFlow(app, 'resolve-conflicts');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Abort merge takes a confirming click, then returns the worktree to its last commit', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { worktree } = await openConflictingPullRequest(app);
		const head = await output(worktree, ['rev-parse', 'HEAD']);
		await resolveConflictsWithTheAgent(app);

		await page.getByRole('button', { name: 'Pull request #7 detail' }).click();
		await page.getByRole('button', { name: 'Abort merge' }).click();
		const confirm = page.getByRole('button', { name: 'Confirm abort' });
		await expect(confirm).toBeVisible();
		expect(await output(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe('');
		await captureFlow(app, 'abort-merge-armed');
		await confirm.click();

		await expect(page.getByRole('status').filter({ hasText: 'Merge aborted' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Resolve merge conflicts #7' })).toBeEnabled({
			timeout: 60_000,
		});
		expect(await output(worktree, ['rev-parse', 'HEAD'])).toBe(head);
		expect(await output(worktree, ['status', '--porcelain'])).toBe('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function openConflictingPullRequest(
	app: LaunchedApp,
): Promise<{ source: string; worktree: string }> {
	const source = await createSourceRepo(app.root);
	writeFileSync(join(source, 'conflict.txt'), 'shared line\n');
	await git(source, ['add', '.']);
	await git(source, ['commit', '-qm', 'shared']);
	const { basePath, worktree } = await seedWorkstream(
		app.page,
		source,
		WORKSTREAM_ID,
		'Conflicting workstream',
	);

	writeFileSync(join(worktree, 'conflict.txt'), 'branch line\n');
	await git(worktree, [...AUTHOR, 'commit', '-qam', 'branch change']);
	await git(worktree, ['push', '-q', '-u', 'origin', BRANCH]);
	writeFileSync(join(source, 'conflict.txt'), 'main line\n');
	await git(source, ['commit', '-qam', 'main change']);
	await git(basePath, ['remote', 'set-url', 'origin', GITHUB_URL]);
	await serveGithubFrom(app, source);
	await openWorkstream(app.page, WORKSTREAM_ID);
	return { source, worktree };
}

async function resolveConflictsWithTheAgent(app: LaunchedApp): Promise<void> {
	const resolve = app.page.getByRole('button', { name: 'Resolve merge conflicts #7' });
	await expect(resolve).toBeEnabled({ timeout: 60_000 });
	await resolve.click();
	await expectAssistantReply(app.page, 60_000);
	await expect(app.page.getByRole('button', { name: 'Commit and push changes #7' })).toBeEnabled({
		timeout: 60_000,
	});
}

async function output(repo: string, args: readonly string[]): Promise<string> {
	return (await execFileAsync('git', [...args], { cwd: repo })).stdout.trim();
}

async function serveGithubFrom(app: LaunchedApp, source: string): Promise<void> {
	const realGit = (await execFileAsync('which', ['git'])).stdout.trim();
	install(
		join(app.home, '.local/bin/git'),
		`#!/bin/sh
for arg do
  case "$arg" in
    push|fetch) exec '${realGit}' -c 'url.${source}.insteadOf=${GITHUB_URL}' -c protocol.file.allow=always "$@" ;;
  esac
done
exec '${realGit}' "$@"
`,
	);
	install(
		join(app.home, '.local/bin/gh'),
		`#!/bin/sh
pull_request() {
  head=$('${realGit}' -C '${source}' rev-parse 'refs/heads/${BRANCH}')
  if '${realGit}' -C '${source}' merge-base --is-ancestor main '${BRANCH}'; then
    mergeable=MERGEABLE; merge_state=CLEAN
  else
    mergeable=CONFLICTING; merge_state=DIRTY
  fi
  printf '{"number":7,"state":"OPEN","isDraft":false,"title":"Conflicting change","url":"https://github.com/e2e/conflict/pull/7","headRefName":"${BRANCH}","baseRefName":"main","headRefOid":"%s","mergeable":"%s","mergeStateStatus":"%s","reviewDecision":null,"statusCheckRollup":[],"updatedAt":"2026-10-02T00:00:00Z"}' "$head" "$mergeable" "$merge_state"
}
case "$1 $2" in
  "auth status") echo "github.com"; echo "  Logged in to github.com account e2e-user (keyring)"; exit 0 ;;
  "api user") echo "e2e-user"; exit 0 ;;
  "repo list") echo "[]"; exit 0 ;;
  "pr list") printf '['; pull_request; echo ']'; exit 0 ;;
  "pr view") pull_request; echo; exit 0 ;;
  "api graphql") echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]},"reviews":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}'; exit 0 ;;
  "repo view")
    if [ "$3" = "--json" ]; then
      echo '{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":false,"viewerDefaultMergeMethod":"SQUASH","viewerPermission":"ADMIN"}'
    else
      echo main
    fi
    exit 0 ;;
esac
if [ "$1" = api ]; then
  case "$2" in
    repos/*/compare/*)
      range="\${2##*/compare/}"
      if [ "$4" = .behind_by ]; then
        '${realGit}' -C '${source}' rev-list --count "\${range##*...}..\${range%%...*}"
        exit 0
      fi ;;
  esac
  echo 0
fi
exit 0
`,
	);
}

function install(path: string, script: string): void {
	writeFileSync(path, script);
	chmodSync(path, 0o755);
}
