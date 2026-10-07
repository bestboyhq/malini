import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
	createSourceRepo,
	git,
	seedWorkstream,
	type LaunchedApp,
	type SeededWorkstream,
} from './harness';

const REPOSITORY = 'e2e/hutch';
const GITHUB_URL = `https://github.com/${REPOSITORY}.git`;
const PULL_REQUEST_NUMBER = 7;

export type FakePullRequest = Record<string, unknown>;

export interface FakeReviewThread {
	readonly id: string;
	readonly isResolved: boolean;
	readonly path: string;
	readonly line: number;
	readonly comments: readonly { readonly body: string }[];
}

export interface FakeGithub {
	pullRequest(): FakePullRequest | null;
	setPullRequest(update: FakePullRequest): void;
	calls(): string[][];
	graphqlMutations(): string[][];
	reviewThreads(): FakeReviewThread[];
	pushedHead(): string;
	pushedSubjects(): string[];
}

export interface PullRequestWorkstream {
	readonly page: Page;
	readonly worktree: string;
	readonly github: FakeGithub;
}

export function reviewThread(id: string, path: string, body: string): FakeReviewThread {
	return { id, isResolved: false, path, line: 1, comments: [{ body }] };
}

export async function seedWorkstreamOnFakeGithub(
	app: LaunchedApp,
	workstreamId: string,
	pullRequest: FakePullRequest | null,
): Promise<PullRequestWorkstream> {
	const { page } = app;
	const source = await createSourceRepo(app.root);
	const seeded = await seedWorkstream(page, source, workstreamId, 'Pull request workstream');
	const github = await fakeGithubFor(app, seeded, pullRequest);
	return { page, worktree: seeded.worktree, github };
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
	mkdirSync(state, { recursive: true });
	await git(state, ['init', '-q', '--bare', remote]);
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
		installStub(join(dir, 'git'), gitShim(remote));
	}

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
		pullRequest: read,
		setPullRequest: (update) =>
			writeFileSync(pullRequestFile, JSON.stringify({ ...(read() ?? seed), ...update })),
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
	};
}

function revParse(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-C', repo, 'rev-parse', ...args], { encoding: 'utf8' }).trim();
}

function installStub(path: string, script: string): void {
	writeFileSync(path, script);
	chmodSync(path, 0o755);
}

function gitShim(remote: string): string {
	const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
	return `#!/bin/sh
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
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (next) => fs.writeFileSync(file, JSON.stringify(next));
const flag = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const out = (value) =>
	process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const [command, sub, third] = args;
if (command === 'auth' && sub === 'status') {
	out('github.com\\n  Logged in to github.com account e2e-user (keyring)\\n');
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
	} else {
		const none = { pageInfo: { hasNextPage: false }, nodes: [] };
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
					author: { login: 'reviewer' },
				})),
			},
		}));
		out({
			data: {
				repository: {
					pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes }, reviews: none },
				},
			},
		});
	}
} else if (command === 'api' && /\\/compare\\//u.test(sub)) {
	out('0\\n');
} else if (command === 'api' && /\\/check-runs\\/\\d+\\/annotations/u.test(sub)) {
	const job = /\\/check-runs\\/(\\d+)\\//u.exec(sub)[1];
	const check = ((read() || {}).statusCheckRollup || []).find((candidate) =>
		String(candidate.detailsUrl || '').endsWith('/job/' + job),
	);
	out((check && check.annotations) || []);
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
	out(read() ? [read()] : []);
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
	save({ ...seed, title: flag('--title'), body: flag('--body') ?? '' });
	out(seed.url + '\\n');
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
		'-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.com',
		'commit-tree', pullRequest.headRefOid + '^{tree}', '-p', remoteMain(),
		'-m', pullRequest.title + ' (#' + pullRequest.number + ')',
	);
	onRemote('update-ref', 'refs/heads/main', squash);
	save({ ...pullRequest, state: 'MERGED', mergeCommit: { oid: squash } });
}
`;
}
