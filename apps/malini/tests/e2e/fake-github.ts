import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
	createSourceRepo,
	git,
	invoke,
	seedWorkstream,
	type LaunchedApp,
	type SeededWorkstream,
} from './harness';

const REPOSITORY = 'e2e/hutch';
const GITHUB_URL = `https://github.com/${REPOSITORY}.git`;
const PULL_REQUEST_NUMBER = 7;
export const WORKSTREAM_NAME = 'Pull request workstream';
const GITHUB_IDENTITY = ['-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.com'];

export type FakePullRequest = Record<string, unknown>;

export interface FakeReviewComment {
	readonly body: string;
	readonly author?: string;
	readonly authorType?: 'Bot' | 'User';
}

export interface FakeReviewThread {
	readonly id: string;
	readonly isResolved: boolean;
	readonly path: string;
	readonly line: number;
	readonly comments: readonly FakeReviewComment[];
}

export interface FakeGithub {
	readonly remote: string;
	pullRequest(): FakePullRequest | null;
	setPullRequest(update: FakePullRequest): void;
	calls(): string[][];
	graphqlMutations(): string[][];
	reviewThreads(): FakeReviewThread[];
	pushedHead(): string;
	pushedSubjects(): string[];
	setOffline(offline: boolean): void;
	answerWith(stderr: string | null): void;
	approveDevice(): void;
}

export interface PullRequestWorkstream {
	readonly page: Page;
	readonly worktree: string;
	readonly github: FakeGithub;
}

export function reviewThread(
	id: string,
	path: string,
	body: string,
	author: Pick<FakeReviewComment, 'author' | 'authorType'> = {},
): FakeReviewThread {
	return { id, isResolved: false, path, line: 1, comments: [{ body, ...author }] };
}

export async function seedWorkstreamOnFakeGithub(
	app: LaunchedApp,
	workstreamId: string,
	pullRequest: FakePullRequest | null,
	beforePublish: (seeded: SeededWorkstream) => Promise<void> = async () => {},
	startedBy: string | null = null,
): Promise<PullRequestWorkstream> {
	const { page } = app;
	const source = await createSourceRepo(app.root, 'hutch');
	const seeded = await seedWorkstream(page, source, workstreamId, WORKSTREAM_NAME, startedBy);
	await beforePublish(seeded);
	const github = await fakeGithubFor(app, seeded, pullRequest);
	return { page, worktree: seeded.worktree, github };
}

export function holdAgentRuns(app: LaunchedApp, held: boolean): void {
	const hold = join(app.home, 'hold-agent-runs');
	if (held) writeFileSync(hold, '');
	else rmSync(hold, { force: true });
}

export function sidebarStatus(page: Page, workstreamId: string): Locator {
	return page
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
		.getByRole('status', { name: /^Workstream status:/u });
}

export function topBarStatus(page: Page, name: string | RegExp): Locator {
	return page.getByRole('navigation', { name: 'Global actions' }).getByRole('status', { name });
}

export function toastSaying(page: Page, text: string): Locator {
	return page.getByTestId('toast').filter({ hasText: text });
}

export async function queueMerge(page: Page): Promise<void> {
	const queue = page.getByRole('button', {
		name: `Merge pull request #${PULL_REQUEST_NUMBER}`,
	});
	await expect(queue).toBeEnabled({ timeout: 30_000 });
	await queue.click();
}

export async function workstreamName(page: Page, workstreamId: string): Promise<string> {
	const workstreams = await invoke<{ id: string; name: string }[]>(
		page,
		'repositories.list-workstreams',
		undefined,
	);
	const name = workstreams.find(({ id }) => id === workstreamId)?.name;
	if (!name) throw new Error(`repositories.list-workstreams does not list ${workstreamId}`);
	return name;
}

export async function expectMergedAndArchived(
	page: Page,
	workstreamId: string,
	name = WORKSTREAM_NAME,
): Promise<void> {
	const row = page
		.getByRole('list', { name: 'Recently archived' })
		.locator(`[data-testid="sidebar-archived-workstream"][data-workstream-id="${workstreamId}"]`);
	await expect(row).toBeVisible({ timeout: 90_000 });
	await expect(
		page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`),
	).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
	await expect(toastSaying(page, 'Merged')).toHaveCount(0);
	await expect(row).toContainText(name);
	await row.hover();
	await expect(
		row.getByRole('button', { name: `Open pull request #${PULL_REQUEST_NUMBER} on GitHub` }),
	).toBeVisible();
}

export async function expectMerged(page: Page, workstreamId: string): Promise<void> {
	await expect(topBarStatus(page, /^Merged/u)).toBeVisible({ timeout: 90_000 });
	await expect(page.getByRole('button', { name: 'Archive this workstream' })).toBeEnabled();
	await expect(page.getByRole('button', { name: /^Continue/u })).toHaveCount(0);
	await expect(
		page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`),
	).toHaveCount(1);
	await expect(page.getByRole('heading', { name: 'Repositories' })).toHaveCount(0);
	await expect(toastSaying(page, 'Merged')).toHaveCount(0);
}

export async function archiveMerged(
	page: Page,
	workstreamId: string,
	name = WORKSTREAM_NAME,
): Promise<void> {
	await page.getByRole('button', { name: 'Archive this workstream' }).click();
	const row = page
		.getByRole('list', { name: 'Recently archived' })
		.locator(`[data-testid="sidebar-archived-workstream"][data-workstream-id="${workstreamId}"]`);
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(
		page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`),
	).toHaveCount(0);
	await expect(row).toContainText(name);
	await row.hover();
	await expect(
		row.getByRole('button', { name: `Open pull request #${PULL_REQUEST_NUMBER} on GitHub` }),
	).toBeVisible();
}

export async function commitByHand(worktree: string, file: string): Promise<void> {
	writeFileSync(join(worktree, file), `${file} committed outside malini\n`);
	await git(worktree, ['add', file]);
	await git(worktree, [
		'-c',
		'user.email=e2e@example.com',
		'-c',
		'user.name=e2e',
		'commit',
		'-qm',
		`Commit ${file} by hand`,
	]);
}

export async function openPullRequestDetail(page: Page): Promise<Locator> {
	await page.getByRole('button', { name: `Pull request #${PULL_REQUEST_NUMBER} detail` }).click();
	const detail = page.getByRole('dialog', { name: `Pull request #${PULL_REQUEST_NUMBER} detail` });
	await expect(detail).toBeVisible();
	return detail;
}

export function headOf(repo: string): string {
	return revParse(repo, 'HEAD');
}

async function fakeGithubFor(
	app: LaunchedApp,
	seeded: SeededWorkstream,
	pullRequest: FakePullRequest | null,
): Promise<FakeGithub> {
	const state = join(app.root, 'fake-github');
	const remote = join(state, 'remote.git');
	const pullRequestFile = join(state, 'pull-request.json');
	const callsFile = join(state, 'gh-calls.log');
	const offline = join(state, 'offline');
	const failure = join(state, 'github-failure');
	mkdirSync(state, { recursive: true });
	await git(state, ['init', '-q', '--bare', '-b', 'main', remote]);
	const branch = revParse(seeded.worktree, '--abbrev-ref', 'HEAD');
	await git(seeded.worktree, ['push', '-q', remote, `HEAD:refs/heads/${branch}`]);
	await git(seeded.basePath, ['push', '-q', remote, 'main:refs/heads/main']);
	await git(seeded.worktree, ['update-ref', `refs/remotes/origin/${branch}`, 'HEAD']);
	await git(seeded.basePath, ['config', `branch.${branch}.remote`, 'origin']);
	await git(seeded.basePath, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
	await git(seeded.basePath, ['remote', 'set-url', 'origin', GITHUB_URL]);
	await git(seeded.basePath, ['config', 'http.proxy', 'http://127.0.0.1:9']);

	const seed = {
		number: PULL_REQUEST_NUMBER,
		state: 'OPEN',
		isDraft: false,
		title: 'Seed pull request',
		body: '',
		url: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}`,
		headRefName: branch,
		headRefOid: headOf(seeded.worktree),
		baseRefName: 'main',
		statusCheckRollup: [],
	};
	writeFileSync(pullRequestFile, JSON.stringify(pullRequest && { ...seed, ...pullRequest }));
	writeFileSync(join(state, 'seed.json'), JSON.stringify(seed));
	writeFileSync(callsFile, '');
	for (const dir of [join(app.home, '.local/bin'), app.bin]) {
		installStub(join(dir, 'gh'), ghStub(state, remote, revParse(seeded.basePath, 'main')));
		installStub(join(dir, 'git'), gitShim(remote, offline));
	}

	const mergeOnGithub = (pullRequest: FakePullRequest, head: string): void => {
		execFileSync('git', [
			'-C',
			seeded.worktree,
			'push',
			'-q',
			'-f',
			remote,
			`${head}:refs/heads/${branch}`,
		]);
		const squash = execFileSync(
			'git',
			[
				'-C',
				remote,
				...GITHUB_IDENTITY,
				'commit-tree',
				`${head}^{tree}`,
				'-p',
				'refs/heads/main',
				'-m',
				`${String(pullRequest['title'])} (#${PULL_REQUEST_NUMBER})`,
			],
			{ encoding: 'utf8' },
		).trim();
		writeAtomically(
			pullRequestFile,
			JSON.stringify({ ...pullRequest, headRefOid: head, mergeCommit: { oid: squash } }),
		);
		execFileSync('git', ['-C', remote, 'update-ref', 'refs/heads/main', squash]);
	};
	const read = (): FakePullRequest | null => {
		const parsed: unknown = JSON.parse(readFileSync(pullRequestFile, 'utf8'));
		return typeof parsed === 'object' && parsed !== null ? { ...parsed } : null;
	};
	const calls = (): string[][] =>
		readFileSync(callsFile, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line): string[] => JSON.parse(line));
	return {
		remote,
		pullRequest: read,
		setPullRequest: (update) => {
			const current = read() ?? seed;
			const next: FakePullRequest = { ...current, ...update };
			const merging = next['state'] === 'MERGED' && current['state'] !== 'MERGED';
			const head =
				typeof update['headRefOid'] === 'string' ? update['headRefOid'] : revParse(remote, branch);
			if (merging && !next['mergeCommit']) mergeOnGithub(next, head);
			else writeAtomically(pullRequestFile, JSON.stringify(next));
		},
		calls,
		graphqlMutations: () =>
			calls().filter(
				(args) =>
					args[0] === 'api' &&
					args[1] === 'graphql' &&
					args.some((arg) => arg.startsWith('query=mutation')),
			),
		reviewThreads: () => {
			const threads = read()?.['reviewThreads'];
			return Array.isArray(threads) ? threads : [];
		},
		pushedHead: () => revParse(remote, branch),
		pushedSubjects: () =>
			execFileSync('git', ['-C', remote, 'log', '--format=%s', branch], { encoding: 'utf8' })
				.split('\n')
				.filter(Boolean),
		setOffline: (next) => (next ? writeFileSync(offline, '') : rmSync(offline, { force: true })),
		answerWith: (stderr) =>
			stderr === null ? rmSync(failure, { force: true }) : writeFileSync(failure, stderr),
		approveDevice: () => writeFileSync(join(state, 'device-approved'), ''),
	};
}

function revParse(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-C', repo, 'rev-parse', ...args], { encoding: 'utf8' }).trim();
}

function writeAtomically(path: string, contents: string): void {
	writeFileSync(`${path}.tmp`, contents);
	renameSync(`${path}.tmp`, path);
}

function installStub(path: string, script: string): void {
	writeFileSync(path, script);
	chmodSync(path, 0o755);
}

function gitShim(remote: string, offline: string): string {
	const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
	return `#!/bin/sh
[ -f "${offline}" ] && exec "${realGit}" "$@"
fetching=
for arg do
  shift
  [ "$arg" = "fetch" ] && fetching=1
  [ "$arg" = "${GITHUB_URL}" ] && arg="${remote}"
  [ -n "$fetching" ] && [ "$arg" = "origin" ] && arg="${remote}"
  set -- "$@" "$arg"
done
exec "${realGit}" -c protocol.file.allow=always "$@"
`;
}

function ghStub(state: string, remote: string, baseOid: string): string {
	return `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const state = ${JSON.stringify(state)};
const file = path.join(state, 'pull-request.json');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'gh-calls.log'), JSON.stringify(args) + '\\n');
const remote = ${JSON.stringify(remote)};
const remoteHead = (branch) => {
	try {
		return execFileSync('git', ['-C', remote, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
};
const read = () => {
	const current = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!current || !current.liveHead || current.state !== 'OPEN') return current;
	const headRefOid = remoteHead(current.headRefName) ?? current.headRefOid;
	const rerun = current.checksHead && current.checksHead !== headRefOid;
	return {
		...current,
		headRefOid,
		...(rerun ? { statusCheckRollup: current.nextChecks || [] } : {}),
		...(current.liveMergeable ? mergeability(headRefOid) : {}),
	};
};
const mergeability = (head) => {
	try {
		execFileSync('git', ['-C', remote, 'merge-base', '--is-ancestor', 'refs/heads/main', head]);
		return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
	} catch {
		return { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
	}
};
const save = (next) => {
	fs.writeFileSync(file + '.tmp', JSON.stringify(next));
	fs.renameSync(file + '.tmp', file);
};
const flag = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const out = (value) =>
	process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const [command, sub, third] = args;
const failure = path.join(state, 'github-failure');
if (command !== 'auth' && fs.existsSync(failure)) {
	process.stderr.write(fs.readFileSync(failure, 'utf8'));
	process.exit(1);
}
if (command === 'auth' && sub === 'status') {
	out('github.com\\n  Logged in to github.com account e2e-user (keyring)\\n');
} else if (command === 'auth' && sub === 'refresh') {
	process.stderr.write('! First copy your one-time code: E2E0-C0DE\\n');
	process.stderr.write('Open this URL to continue in your web browser: https://github.com/login/device\\n');
	const approved = path.join(state, 'device-approved');
	const waitForApproval = () =>
		fs.existsSync(approved) ? process.exit(0) : setTimeout(waitForApproval, 100);
	waitForApproval();
} else if (command === 'api' && sub === 'user') {
	out('e2e-user\\n');
} else if (command === 'api' && sub === 'graphql') {
	const fields = {};
	args.forEach((arg, index) => {
		if (args[index - 1] !== '-f' && args[index - 1] !== '-F') return;
		const split = arg.indexOf('=');
		fields[arg.slice(0, split)] = arg.slice(split + 1);
	});
	const current = read();
	const threads = (current && current.reviewThreads) || [];
	const thread = threads.find((candidate) => candidate.id === fields.threadId);
	if (fields.query.startsWith('mutation') && !thread) {
		process.stderr.write("gh: Could not resolve to a node with the global id of '" + fields.threadId + "'.\\n");
		process.exit(1);
	}
	if (fields.query.includes('addPullRequestReviewThreadReply')) {
		thread.comments.push({ body: fields.body });
		save(current);
		out({ data: { addPullRequestReviewThreadReply: { comment: { id: 'reply' } } } });
	} else if (fields.query.includes('resolveReviewThread')) {
		thread.isResolved = true;
		save(current);
		out({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
	} else if (fields.query.includes('checkSuites')) {
		const suites = ((current && current.reportingApps) || []).map((databaseId) => ({
			app: { databaseId },
			checkRuns: { totalCount: 1 },
		}));
		out({ data: { repository: { object: { history: { nodes: [{ checkSuites: { nodes: suites } }] } } } } });
	} else {
		const nodes = threads.map((candidate) => ({
			...candidate,
			isOutdated: false,
			diffSide: 'RIGHT',
			subjectType: 'LINE',
			comments: {
				nodes: candidate.comments.map((comment, index) => ({
					id: candidate.id + '-comment-' + index,
					body: comment.body,
					createdAt: '2026-10-02T10:00:00Z',
					updatedAt: '2026-10-02T10:00:00Z',
					author: {
						__typename: comment.authorType || 'User',
						login: comment.author || 'reviewer',
					},
				})),
			},
		}));
		out({
			data: {
				repository: {
					pullRequest: {
						reviewThreads: { pageInfo: { hasNextPage: false }, nodes },
						reviews: {
							pageInfo: { hasNextPage: false },
							nodes: ((current && current.changeRequests) || []).map((review) => ({
								id: review.id,
								body: review.body,
								state: 'CHANGES_REQUESTED',
								submittedAt: '2026-10-02T10:00:00Z',
								updatedAt: '2026-10-02T10:00:00Z',
								author: { __typename: review.authorType || 'User', login: review.author || 'reviewer' },
							})),
						},
					},
				},
			},
		});
	}
} else if (command === 'api' && sub.includes('/compare/')) {
	const [base, head] = sub.split('/compare/')[1].split('...');
	const commit = (ref) => {
		try {
			return execFileSync('git', ['-C', remote, 'rev-parse', '--verify', '--quiet', ref + '^{commit}'], { encoding: 'utf8' }).trim();
		} catch {
			return null;
		}
	};
	const [baseSha, headSha] = [commit(base), commit(head)];
	if (!baseSha || !headSha) {
		process.stderr.write('gh: Not Found (HTTP 404)\\n');
		process.exit(1);
	}
	const count = (from, to) =>
		Number(execFileSync('git', ['-C', remote, 'rev-list', '--count', from + '..' + to], { encoding: 'utf8' }));
	const [behind, ahead] = [count(headSha, baseSha), count(baseSha, headSha)];
	const status = behind === 0 ? (ahead === 0 ? 'identical' : 'ahead') : ahead === 0 ? 'behind' : 'diverged';
	out((flag('--jq') === '.status' ? status : String(behind)) + '\\n');
} else if (
	command === 'api' &&
	flag('-X') === 'POST' &&
	/\\/actions\\/runs\\/\\d+\\/rerun-failed-jobs$/u.test(args[args.length - 1])
) {
	const current = read();
	if (!current || !current.rerunChecks) {
		process.stderr.write('gh: Resource not accessible by integration (HTTP 403)\\n');
		process.exit(1);
	}
	const finishedLater = new Date(Date.now() + 60000).toISOString();
	save({
		...current,
		statusCheckRollup: current.rerunChecks.map((check) =>
			check.conclusion && !check.completedAt ? { ...check, completedAt: finishedLater } : check,
		),
	});
	out('');
} else if (command === 'api' && /\\/check-runs\\/\\d+\\/annotations/u.test(sub)) {
	const job = /\\/check-runs\\/(\\d+)\\//u.exec(sub)[1];
	const check = ((read() || {}).statusCheckRollup || []).find((candidate) =>
		String(candidate.detailsUrl || '').endsWith('/job/' + job),
	);
	out((check && check.annotations) || []);
} else if (command === 'api' && /\\/commits\\/[^/]+\\/check-suites/u.test(sub)) {
	const suites = (read() || {}).checkSuites || [];
	out({ total_count: suites.length, check_suites: suites });
} else if (command === 'api' && /\\/commits\\/[^/]+\\/check-runs/u.test(sub)) {
	out({ total_count: 0, check_runs: [] });
} else if (command === 'api' && /\\/commits\\/[^/]+\\/statuses/u.test(sub)) {
	out([]);
} else if (command === 'repo' && sub === 'view') {
	out(
		third === '--json'
			? {
					mergeCommitAllowed: false,
					squashMergeAllowed: true,
					rebaseMergeAllowed: false,
					viewerDefaultMergeMethod: 'SQUASH',
					viewerPermission: 'WRITE',
				}
			: 'main\\n',
	);
} else if (command === 'repo' && sub === 'list') {
	out('[]');
} else if (command === 'pr' && sub === 'list') {
	const current = read();
	const head = flag('--head');
	out(current && (head === undefined || current.headRefName === head) ? [current] : []);
} else if (command === 'pr' && sub === 'view') {
	if (!read()) {
		process.stderr.write('no pull requests found for branch\\n');
		process.exit(1);
	}
	out(read());
} else if (command === 'pr' && sub === 'create') {
	const head = flag('--head');
	const commits = execFileSync(
		'git',
		['-C', ${JSON.stringify(remote)}, 'rev-list', '--count', '${baseOid}..refs/heads/' + head],
		{ encoding: 'utf8' },
	).trim();
	if (commits === '0') {
		process.stderr.write('pull request create failed: GraphQL: No commits between ' + flag('--base') + ' and ' + head + ' (createPullRequest)\\n');
		process.exit(1);
	}
	const seed = JSON.parse(fs.readFileSync(path.join(state, 'seed.json'), 'utf8'));
	save({
		...seed,
		headRefName: head,
		liveHead: true,
		isDraft: args.includes('--draft'),
		title: flag('--title'),
		body: flag('--body') ?? '',
	});
	out(seed.url + '\\n');
} else if (command === 'pr' && sub === 'reopen') {
	const current = read();
	if (!current || current.state !== 'CLOSED') {
		process.stderr.write('pull request is not closed\\n');
		process.exit(1);
	}
	save({ ...current, state: 'OPEN' });
	out('');
} else if (command === 'pr' && sub === 'ready') {
	save({ ...read(), isDraft: false });
	out('');
} else if (command === 'pr' && sub === 'edit') {
	const title = flag('--title');
	const body = flag('--body');
	save({ ...read(), ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }) });
	out(read().url + '\\n');
} else if (command === 'pr' && sub === 'merge') {
	const pullRequest = read();
	const onRemote = (...gitArgs) =>
		execFileSync('git', ['-C', ${JSON.stringify(remote)}, ...gitArgs], { encoding: 'utf8' }).trim();
	const remoteMain = () => {
		try {
			return onRemote('rev-parse', '--verify', '--quiet', 'refs/heads/main');
		} catch {
			return '${baseOid}';
		}
	};
	const squash = onRemote(
		...${JSON.stringify(GITHUB_IDENTITY)},
		'commit-tree', pullRequest.headRefOid + '^{tree}', '-p', remoteMain(),
		'-m', pullRequest.title + ' (#' + pullRequest.number + ')',
	);
	save({ ...pullRequest, state: 'MERGED', mergeCommit: { oid: squash } });
	onRemote('update-ref', 'refs/heads/main', squash);
}
`;
}
