import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	JOB_INTERRUPTED_DETAIL,
	type JobDefinitionRecord,
	type JobRunRecord,
	type JobRunStatus,
	type RunJobArgs,
} from '$contract/jobs';
import {
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	type ShipChangedEvent,
	type ShipStateRecord,
} from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { workstreamPath } from '$main/git/paths';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import type { PullRequestsPlatform } from '../pull-requests.platform';
import type { GhRunner } from './pull-requests.service';
import { registerPullRequests } from './register';

const DELAYS = {
	idleDebounceMs: 40,
	agentPollMs: 60,
	checksPollMs: 20,
	reviewPollMs: 20,
	githubPollMs: 20,
	backoffBaseMs: 40,
	backoffCapMs: 160,
};

const WAIT = { timeout: 8_000, interval: 15 };

type FakeCheck = { name: string; status: string; conclusion: string; completedAt?: string };

type FakeThread = { id: string; bot: boolean; resolved: boolean };

type FakePullRequest = {
	number: number;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	isDraft: boolean;
	title: string;
	body: string;
	headRefName: string;
	headRefOid: string;
	mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
	mergeStateStatus: string;
	reviewDecision: string | null;
	checks: FakeCheck[];
	threads: FakeThread[];
	changeRequests: { id: string; login: string; bot: boolean }[];
};

function ok(stdout: string): GhResult {
	return { stdout, stderr: '', code: 0 };
}

function argAfter(args: readonly string[], flag: string): string {
	return args[args.indexOf(flag) + 1] ?? '';
}

class FakeGithub {
	readonly pulls: FakePullRequest[] = [];
	readonly calls: string[][] = [];
	readonly replies: string[] = [];
	ciOutcomes: string[] = [];
	outage = 0;
	authRejected = false;

	readonly run: GhRunner = async (args) => {
		this.calls.push([...args]);
		if (this.authRejected) {
			return {
				stdout: '',
				stderr: 'gh: To get started with GitHub CLI, please run:  gh auth login',
				code: 4,
			};
		}
		if (this.outage > 0) {
			this.outage -= 1;
			return { stdout: '', stderr: 'error connecting to api.github.com', code: 1 };
		}
		return this.answer(args);
	};

	pull(branch: string): FakePullRequest | undefined {
		return this.pulls.filter((pull) => pull.headRefName === branch).at(-1);
	}

	only(): FakePullRequest {
		const pull = this.pulls[0];
		if (!pull) throw new Error('no pull request yet');
		return pull;
	}

	pushed(branch: string, sha: string): void {
		const pull = this.pull(branch);
		if (!pull || pull.state !== 'OPEN') return;
		pull.headRefOid = sha;
		const outcome = this.ciOutcomes.shift() ?? 'SUCCESS';
		pull.checks = [
			outcome === 'PENDING'
				? { name: 'test', status: 'IN_PROGRESS', conclusion: '' }
				: { name: 'test', status: 'COMPLETED', conclusion: outcome },
		];
		pull.mergeable = 'MERGEABLE';
		pull.mergeStateStatus = outcome === 'SUCCESS' ? 'CLEAN' : 'BLOCKED';
	}

	count(prefix: readonly string[]): number {
		return this.calls.filter((call) => prefix.every((part, index) => call[index] === part)).length;
	}

	private answer(args: readonly string[]): GhResult {
		const [group, verb] = args;
		if (group === 'pr' && verb === 'list') {
			const pull = this.pull(argAfter(args, '--head'));
			return ok(JSON.stringify(pull ? [this.view(pull)] : []));
		}
		if (group === 'pr' && verb === 'view') {
			const pull = this.find(args[2] ?? '');
			if (!pull) return { stdout: '', stderr: 'no pull requests found', code: 1 };
			if (argAfter(args, '--json') === 'state,title,body') {
				return ok(JSON.stringify({ state: pull.state, title: pull.title, body: pull.body }));
			}
			return ok(JSON.stringify(this.view(pull)));
		}
		if (group === 'pr' && verb === 'create') return this.create(args);
		if (group === 'pr' && verb === 'ready') {
			this.require(args[2]).isDraft = false;
			return ok('');
		}
		if (group === 'pr' && verb === 'merge') {
			const pull = this.require(args[2]);
			if (argAfter(args, '--match-head-commit') !== pull.headRefOid) {
				return { stdout: '', stderr: 'Head branch was modified', code: 1 };
			}
			pull.state = 'MERGED';
			return ok('');
		}
		if (group === 'pr' && verb === 'edit') {
			const pull = this.require(args[2]);
			if (args.includes('--title')) pull.title = argAfter(args, '--title');
			if (args.includes('--body')) pull.body = argAfter(args, '--body');
			return ok('');
		}
		if (group === 'repo' && verb === 'view') {
			return ok(
				JSON.stringify({
					mergeCommitAllowed: false,
					squashMergeAllowed: true,
					rebaseMergeAllowed: false,
					viewerDefaultMergeMethod: 'SQUASH',
					viewerPermission: 'WRITE',
				}),
			);
		}
		if (group === 'api' && verb === 'graphql') return this.graphql(args);
		if (group === 'api' && verb?.includes('/compare/')) {
			if (argAfter(args, '--jq') === '.status') return ok('identical');
			const pull = this.pulls.find((candidate) => verb.includes(candidate.headRefOid));
			const stale =
				pull && (pull.mergeable === 'CONFLICTING' || pull.mergeStateStatus === 'BEHIND');
			return ok(stale ? '2' : '0');
		}
		if (group === 'api' && verb?.includes('/check-runs')) {
			const pull = this.pulls.find((candidate) => verb.includes(candidate.headRefOid));
			return ok(
				JSON.stringify({
					check_runs: (pull?.checks ?? []).map((entry, index) => ({
						id: index + 1,
						name: entry.name,
						status: 'completed',
						conclusion: entry.conclusion.toLowerCase(),
						output: { title: 'Tests failed', summary: 'expected 2 to equal 3' },
					})),
				}),
			);
		}
		if (group === 'api' && verb?.includes('/statuses')) return ok('[]');
		return ok('');
	}

	private create(args: readonly string[]): GhResult {
		const number = 40 + this.pulls.length;
		const head = argAfter(args, '--head');
		this.pulls.push({
			number,
			state: 'OPEN',
			isDraft: args.includes('--draft'),
			title: argAfter(args, '--title'),
			body: argAfter(args, '--body'),
			headRefName: head,
			headRefOid: heads.get(head) ?? 'f'.repeat(40),
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			reviewDecision: null,
			checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
			threads: [],
			changeRequests: [],
		});
		return ok(`https://github.com/acme/app/pull/${number}\n`);
	}

	private graphql(args: readonly string[]): GhResult {
		const query = args.find((arg) => arg.startsWith('query=')) ?? '';
		const threadId = args.find((arg) => arg.startsWith('threadId='))?.slice('threadId='.length);
		if (query.includes('addPullRequestReviewThreadReply')) {
			this.replies.push(`${threadId}: ${args.find((arg) => arg.startsWith('body='))?.slice(5)}`);
			return ok('{"data":{}}');
		}
		if (query.includes('resolveReviewThread')) {
			for (const pull of this.pulls) {
				for (const thread of pull.threads) if (thread.id === threadId) thread.resolved = true;
			}
			return ok('{"data":{}}');
		}
		const number = Number(args.find((arg) => arg.startsWith('number='))?.slice(7));
		const pull = this.pulls.find((candidate) => candidate.number === number);
		const author = (bot: boolean, login: string): object =>
			bot ? { __typename: 'Bot', login } : { __typename: 'User', login };
		return ok(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							reviewThreads: {
								pageInfo: { hasNextPage: false },
								nodes: (pull?.threads ?? []).map((thread) => ({
									id: thread.id,
									isResolved: thread.resolved,
									isOutdated: false,
									path: 'src/search.ts',
									line: 3,
									diffSide: 'RIGHT',
									subjectType: 'LINE',
									comments: {
										nodes: [
											{
												id: `${thread.id}-comment`,
												body: 'Handle the empty query.',
												createdAt: '2026-10-01T00:00:00Z',
												updatedAt: '2026-10-01T00:00:00Z',
												author: author(thread.bot, thread.bot ? 'coderabbitai' : 'alice'),
											},
										],
									},
								})),
							},
							reviews: {
								pageInfo: { hasNextPage: false },
								nodes: (pull?.changeRequests ?? []).map((review) => ({
									id: review.id,
									body: 'Please change this.',
									state: 'CHANGES_REQUESTED',
									submittedAt: '2026-10-01T00:00:00Z',
									updatedAt: '2026-10-01T00:00:00Z',
									author: author(review.bot, review.login),
								})),
							},
						},
					},
				},
			}),
		);
	}

	private find(target: string): FakePullRequest | undefined {
		const number = Number(target.split('/').at(-1));
		return this.pulls.find((pull) => pull.number === number);
	}

	private require(target: string | undefined): FakePullRequest {
		const pull = this.find(target ?? '');
		if (!pull) throw new Error(`unknown pull request ${target}`);
		return pull;
	}

	private view(pull: FakePullRequest): Record<string, unknown> {
		return {
			number: pull.number,
			state: pull.state,
			isDraft: pull.isDraft,
			title: pull.title,
			url: `https://github.com/acme/app/pull/${pull.number}`,
			headRefName: pull.headRefName,
			baseRefName: 'main',
			headRefOid: pull.headRefOid,
			mergeable: pull.mergeable,
			mergeStateStatus: pull.isDraft ? 'DRAFT' : pull.mergeStateStatus,
			reviewDecision: pull.reviewDecision,
			statusCheckRollup: pull.checks.map((entry) => ({ __typename: 'CheckRun', ...entry })),
			updatedAt: '2026-10-01T00:00:00Z',
			mergeCommit: null,
		};
	}
}

const heads = new Map<string, string>();

let root: string;
let db: MaliniDatabase;
let context: MainContext;
let github: FakeGithub;
let platform: PullRequestsPlatform;
let worktrees: Map<string, WorktreeStatus>;
let openRuns: Set<string>;
let jobRuns: Map<string, JobRunRecord>;
let jobContexts: Map<string, string>;
let settings: Record<string, string>;
let shipEvents: ShipChangedEvent[];
let commits: { workstreamId: string; message: string; runId: string | null; sha: string }[];
let pushes: string[];
let pulls: string[];
let archived: string[];
let pullConflicts: string[];
let behind: Map<string, number>;
let shaCounter: number;
let clockOffsetMs: number;

const DEFINITIONS: JobDefinitionRecord[] = (
	['fix-checks', 'update-from-main', 'address-review'] as const
).map((builtin) => ({
	id: `def-${builtin}`,
	name: builtin,
	instructions: `Do ${builtin}.`,
	model: 'anthropic/claude-sonnet-4-6',
	effort: 'medium',
	runsIn: 'workstream',
	output: 'none',
	builtin,
	createdAt: '2026-10-01T00:00:00Z',
	updatedAt: '2026-10-01T00:00:00Z',
}));

function nextSha(): string {
	shaCounter += 1;
	return shaCounter.toString(16).padStart(40, '0');
}

function worktree(workstreamId: string): WorktreeStatus {
	const current = worktrees.get(workstreamId);
	if (!current) throw new Error(`no worktree for ${workstreamId}`);
	return current;
}

function seedWorkstream(workstreamId: string, overrides: Partial<WorktreeStatus> = {}): void {
	const path = workstreamPath(context.appDataRoot, workstreamId);
	mkdirSync(path, { recursive: true });
	db.prepare(
		`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
		 VALUES (?, 'p-1', ?, ?, ?, 'main', 'active', '2026-10-01T00:00:00Z')`,
	).run(workstreamId, workstreamId, path, `malini/${workstreamId}`);
	db.prepare(
		`INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, display_name)
		 VALUES (?, ?, 'anthropic/claude-sonnet-4-6', 'completed', '2026-10-01T00:00:00Z', 'Search')`,
	).run(`session-${workstreamId}`, workstreamId);
	const headSha = nextSha();
	heads.set(`malini/${workstreamId}`, headSha);
	worktrees.set(workstreamId, {
		branch: `malini/${workstreamId}`,
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: false,
		mergeInProgress: false,
		operationInProgress: null,
		headSha,
		...overrides,
	});
}

let runCounter = 0;

function finishUserRun(workstreamId: string, summary: string, dirtyPaths: string[]): string {
	runCounter += 1;
	const runId = `user-run-${runCounter}`;
	db.prepare(
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary)
		 VALUES (?, ?, 'Add search to the header', '2026-10-01T00:00:01Z', '2026-10-01T00:00:09Z', ?)`,
	).run(runId, `session-${workstreamId}`, summary);
	const current = worktree(workstreamId);
	worktrees.set(workstreamId, { ...current, dirtyPaths: [...current.dirtyPaths, ...dirtyPaths] });
	openRuns.delete(workstreamId);
	context.events.emit('chat:agent-event', {
		sessionId: `session-${workstreamId}`,
		runId,
		seq: runCounter,
		event: { type: 'run.completed', summary },
	});
	return runId;
}

function finishJob(
	jobRunId: string,
	status: JobRunStatus,
	options: { summary?: string; dirtyPaths?: string[]; resolveConflicts?: boolean } = {},
): void {
	const run = jobRuns.get(jobRunId);
	if (!run?.workstreamId || !run.agentRunId) throw new Error(`unknown job ${jobRunId}`);
	db.prepare('UPDATE agent_runs SET summary = ?, completed_at = ? WHERE id = ?').run(
		options.summary ?? 'Done.',
		'2026-10-01T00:01:00Z',
		run.agentRunId,
	);
	const current = worktree(run.workstreamId);
	worktrees.set(run.workstreamId, {
		...current,
		dirtyPaths: [...current.dirtyPaths, ...(options.dirtyPaths ?? [])],
		...(options.resolveConflicts ? { conflictedPaths: [], conflictMarkerPaths: [] } : {}),
	});
	const finished: JobRunRecord = {
		...run,
		status,
		detail: options.summary ?? null,
		finishedAt: new Date().toISOString(),
	};
	jobRuns.set(jobRunId, finished);
	context.events.emit('jobs:run-changed', { run: finished });
}

function defineFakes(): void {
	const { commands, events } = context;
	commands.define('repositories.workstream-status', (args: unknown) => {
		const id = String(Reflect.get(Object(args), 'workstreamId'));
		return { ...worktree(id) };
	});
	commands.define('repositories.commit-workstream', (args: unknown) => {
		const workstreamId = String(Reflect.get(Object(args), 'workstreamId'));
		const message = String(Reflect.get(Object(args), 'message'));
		const run: unknown = Reflect.get(Object(args), 'run');
		const runId = run ? String(Reflect.get(Object(run), 'id')) : null;
		const current = worktree(workstreamId);
		if (current.dirtyPaths.length === 0 && current.operationInProgress === null) {
			throw new Error('Nothing to commit - no repository changes.');
		}
		const sha = nextSha();
		worktrees.set(workstreamId, {
			...current,
			dirtyPaths: [],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			mergeInProgress: false,
			operationInProgress: null,
			ahead: current.ahead + 1,
			headSha: sha,
		});
		commits.push({ workstreamId, message, runId, sha });
		if (runId) {
			db.prepare(
				`INSERT OR IGNORE INTO workstream_commit_runs (workstream_id, run_id, commit_sha, committed_at)
				 VALUES (?, ?, ?, '2026-10-01T00:02:00Z')`,
			).run(workstreamId, runId, sha);
		}
		return sha;
	});
	commands.define('repositories.push-workstream', (args: unknown) => {
		const workstreamId = String(Reflect.get(Object(args), 'workstreamId'));
		expect(Reflect.get(Object(args), 'expectedRepositoryFullName')).toBe('acme/app');
		const current = worktree(workstreamId);
		worktrees.set(workstreamId, { ...current, ahead: 0, hasUpstream: true });
		heads.set(current.branch, current.headSha ?? '');
		pushes.push(workstreamId);
		github.pushed(current.branch, current.headSha ?? '');
		return current.branch;
	});
	commands.define('repositories.pull-workstream', (args: unknown) => {
		const workstreamId = String(Reflect.get(Object(args), 'workstreamId'));
		const current = worktree(workstreamId);
		pulls.push(workstreamId);
		worktrees.set(
			workstreamId,
			pullConflicts.length > 0
				? {
						...current,
						operationInProgress: 'merge',
						mergeInProgress: true,
						dirtyPaths: [...pullConflicts],
						conflictedPaths: [...pullConflicts],
						conflictMarkerPaths: [...pullConflicts],
					}
				: { ...current, ahead: current.ahead + 1, headSha: nextSha() },
		);
		return 'abc1234';
	});
	commands.define(
		'repositories.count-behind-base',
		(args: unknown) => behind.get(String(Reflect.get(Object(args), 'workstreamId'))) ?? 0,
	);
	commands.define('repositories.archive-workstream', (args: unknown) => {
		const workstreamId = String(Reflect.get(Object(args), 'workstreamId'));
		expect(shipEvents.at(-1)).toMatchObject({ workstreamId, state: null, merged: {} });
		archived.push(workstreamId);
		db.prepare(
			'DELETE FROM agent_runs WHERE session_id IN (SELECT id FROM agent_sessions WHERE workstream_id = ?)',
		).run(workstreamId);
		db.prepare('DELETE FROM agent_sessions WHERE workstream_id = ?').run(workstreamId);
		db.prepare('DELETE FROM workstream_commit_runs WHERE workstream_id = ?').run(workstreamId);
		db.prepare('DELETE FROM workstreams WHERE id = ?').run(workstreamId);
		events.emit('repositories:workstream-removed', {
			workstreamId,
			worktreePath: '',
			archived: true,
		});
		return { savedWork: null };
	});
	commands.define('repositories.workstream-change-totals', (args: unknown) => {
		const workstreamId = String(Reflect.get(Object(args), 'workstreamId'));
		const current = worktree(workstreamId);
		const files = current.dirtyPaths.length + current.ahead + (current.hasUpstream ? 0 : 1);
		return { additions: files, deletions: 0, files };
	});
	commands.define('chat.workstream-has-open-run', (args: unknown) =>
		openRuns.has(String(Reflect.get(Object(args), 'workstreamId'))),
	);
	commands.define('app.list-settings', () => ({ ...settings }));
	commands.define('jobs.list-definitions', () => DEFINITIONS);
	commands.define('jobs.list-runs', () => [...jobRuns.values()]);
	commands.define('jobs.run', (args: RunJobArgs) => {
		const index = jobRuns.size + 1;
		const workstreamId = args.workstreamId ?? null;
		const definition = DEFINITIONS.find((candidate) => candidate.id === args.definitionId);
		const sessionId = `job-session-${index}`;
		const agentRunId = `job-agent-run-${index}`;
		db.prepare(
			`INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, display_name, origin)
			 VALUES (?, ?, 'anthropic/claude-sonnet-4-6', 'running', '2026-10-01T00:00:00Z', 'Job', 'job')`,
		).run(sessionId, workstreamId);
		db.prepare(
			`INSERT INTO agent_runs (id, session_id, prompt, started_at, automated)
			 VALUES (?, ?, ?, '2026-10-01T00:00:30Z', 1)`,
		).run(agentRunId, sessionId, `${definition?.instructions}\n\n${args.context ?? ''}`);
		const run: JobRunRecord = {
			id: `job-${index}`,
			definitionId: args.definitionId,
			title: definition?.name ?? 'job',
			workstreamId,
			repositoryId: null,
			sessionId,
			agentRunId,
			origin: args.origin ?? 'manual',
			status: 'running',
			detail: null,
			createdAt: new Date(Date.now() + index).toISOString(),
			startedAt: null,
			finishedAt: null,
		};
		jobRuns.set(run.id, run);
		jobContexts.set(run.id, args.context ?? '');
		events.emit('jobs:run-changed', { run });
		return run;
	});
	commands.define('jobs.cancel-run', (args: unknown) => {
		const id = String(Reflect.get(Object(args), 'jobRunId'));
		const run = jobRuns.get(id);
		if (!run) throw new Error('not found');
		const cancelled: JobRunRecord = { ...run, status: 'cancelled' };
		jobRuns.set(id, cancelled);
		events.emit('jobs:run-changed', { run: cancelled });
		return cancelled;
	});
}

function start(): void {
	platform = registerPullRequests(context, {
		runner: github.run,
		ship: { delays: DELAYS, now: () => Date.now() + clockOffsetMs },
	});
	platform.start();
}

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.handle({ command, args });
	if (!response.ok) throw Object.assign(new Error(response.failure.message), response.failure);
	return response.value;
}

function ship(workstreamId: string): ShipStateRecord | undefined {
	return (
		shipEvents.filter((event) => event.workstreamId === workstreamId).at(-1)?.state ?? undefined
	);
}

async function until(assertion: () => void): Promise<void> {
	await vi.waitFor(assertion, WAIT);
}

function activeJob(): JobRunRecord {
	const running = [...jobRuns.values()].filter((run) => run.status === 'running');
	const [job] = running;
	if (!job || running.length !== 1)
		throw new Error(`expected one running job, saw ${running.length}`);
	return job;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-merge-queue-')));
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: join(root, 'app-data'),
		resourcesRoot: root,
		isDev: true,
		appVersion: '0.1.0',
	};
	const base = join(root, 'base');
	execFileSync('git', ['init', '-q', '-b', 'main', base]);
	execFileSync('git', ['-C', base, 'remote', 'add', 'origin', 'git@github.com:acme/app.git']);
	db.prepare(
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES ('p-1', 'app', ?, 'main', '2026-10-01T00:00:00Z')`,
	).run(base);
	github = new FakeGithub();
	heads.clear();
	worktrees = new Map();
	openRuns = new Set();
	jobRuns = new Map();
	jobContexts = new Map();
	settings = {};
	shipEvents = [];
	commits = [];
	pushes = [];
	pulls = [];
	archived = [];
	pullConflicts = [];
	behind = new Map();
	shaCounter = 0;
	clockOffsetMs = 0;
	runCounter = 0;
	context.events.subscribe('pull-requests:ship-changed', (event) => shipEvents.push(event));
	defineFakes();
});

afterEach(() => {
	platform?.dispose();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('opening a draft', () => {
	it('commits, pushes and opens a draft pull request with generated text', async () => {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Added search to the header', ['src/search.ts']);

		const record = await invoke<ShipStateRecord>('pull-requests.open-draft', {
			workstreamId: 'ws-1',
		});

		expect(record).toMatchObject({ phase: 'draft', step: 'opening-draft' });
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
		expect(commits).toMatchObject([{ workstreamId: 'ws-1', runId: 'user-run-1' }]);
		expect(pushes).toEqual(['ws-1']);
		expect(github.only()).toMatchObject({ isDraft: true, title: 'Added search to the header' });
		expect(ship('ws-1')?.pullRequestUrl).toBe('https://github.com/acme/app/pull/40');
	});

	it('refuses with a typed error when there is nothing to ship and no pull request', async () => {
		seedWorkstream('ws-1', { hasUpstream: true });
		start();

		await expect(
			invoke('pull-requests.open-draft', { workstreamId: 'ws-1' }),
		).rejects.toMatchObject({ name: 'ShipError', kind: 'nothing-to-ship' });
		await expect(
			invoke('pull-requests.open-draft', { workstreamId: 'nope' }),
		).rejects.toMatchObject({ kind: 'unknown-workstream' });
		expect(await invoke('pull-requests.ship-states')).toEqual([]);
	});

	it('adopts a pull request that already exists for the branch instead of opening another', async () => {
		seedWorkstream('ws-1', { hasUpstream: true });
		github.pulls.push({
			number: 12,
			state: 'OPEN',
			isDraft: false,
			title: 'Mine',
			body: '',
			headRefName: 'malini/ws-1',
			headRefOid: heads.get('malini/ws-1') ?? '',
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			reviewDecision: null,
			checks: [],
			threads: [],
			changeRequests: [],
		});
		start();

		await invoke('pull-requests.open-draft', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 12, step: null }));
		expect(github.count(['pr', 'create'])).toBe(0);
		expect(pushes).toEqual([]);
	});
});

describe('pushing automatically', () => {
	async function openDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Added search to the header', ['src/search.ts']);
		await invoke('pull-requests.open-draft', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	it('pushes once the agent goes idle and retitles a title the user left alone', async () => {
		await openDraft();
		openRuns.add('ws-1');
		finishUserRun('ws-1', 'Added fuzzy matching to search', ['src/fuzzy.ts']);
		openRuns.add('ws-1');
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));
		expect(pushes).toEqual(['ws-1']);

		openRuns.delete('ws-1');
		finishUserRun('ws-1', 'Ranked exact matches first', []);

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		expect(commits).toHaveLength(2);
		await until(() => expect(github.only().title).toBe('Ranked exact matches first'));
		await until(() => expect(ship('ws-1')).toMatchObject({ phase: 'draft', step: null }));
	});

	it('keeps a title the user edited on GitHub', async () => {
		await openDraft();
		github.only().title = 'My own title';

		finishUserRun('ws-1', 'Added fuzzy matching to search', ['src/fuzzy.ts']);

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		await until(() => expect(ship('ws-1')?.step).toBeNull());
		expect(github.only().title).toBe('My own title');
	});

	it('commits each finished run locally and never pushes before a pull request exists', async () => {
		seedWorkstream('ws-1');
		start();
		const runId = finishUserRun('ws-1', 'Added search to the header', ['src/search.ts']);

		await until(() =>
			expect(commits).toMatchObject([{ message: 'Added search to the header', runId }]),
		);
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 3));
		expect(pushes).toEqual([]);
		expect(github.pulls).toHaveLength(0);
		expect(ship('ws-1')).toMatchObject({ phase: 'local', step: null });
	});
});

describe('keeping a workstream current with main', () => {
	async function openDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Added search to the header', ['src/search.ts']);
		await invoke('pull-requests.open-draft', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	function mergeMain(workstreamId: string, conflicts: string[] = []): void {
		const current = worktree(workstreamId);
		behind.set(workstreamId, 0);
		worktrees.set(
			workstreamId,
			conflicts.length === 0
				? { ...current, ahead: current.ahead + 1, headSha: nextSha() }
				: {
						...current,
						operationInProgress: 'merge',
						mergeInProgress: true,
						dirtyPaths: [...conflicts],
						conflictedPaths: [...conflicts],
						conflictMarkerPaths: [...conflicts],
					},
		);
	}

	it('leaves a workstream that is up to date alone', async () => {
		seedWorkstream('ws-1');
		start();

		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')).toMatchObject({ phase: 'local' }));
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));
		expect(jobRuns.size).toBe(0);
	});

	it('runs Update from main when a draft behind main opens, then pushes the clean merge', async () => {
		await openDraft();
		behind.set('ws-1', 3);

		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')?.step).toBe('updating-from-main'));
		const job = activeJob();
		expect(job).toMatchObject({ definitionId: 'def-update-from-main', origin: 'merge-queue' });
		mergeMain('ws-1');
		finishJob(job.id, 'succeeded', { summary: 'Merged 3 commits from main' });

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		await until(() => expect(ship('ws-1')).toMatchObject({ phase: 'draft', step: null }));
		expect(jobRuns.size).toBe(1);
	});

	it('retries conflicts the update could not resolve, then commits and pushes the merge', async () => {
		await openDraft();
		behind.set('ws-1', 2);
		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('updating-from-main'));
		const first = activeJob();
		mergeMain('ws-1', ['src/search.ts']);
		finishJob(first.id, 'succeeded');

		await until(() => expect(jobRuns.size).toBe(2));
		const second = activeJob();
		expect(second.definitionId).toBe('def-update-from-main');
		finishJob(second.id, 'succeeded', { resolveConflicts: true });

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		expect(commits.at(-1)).toMatchObject({ message: 'Merge main into malini/ws-1' });
	});

	it('commits leftover work when a local workstream opens, then updates it from main', async () => {
		seedWorkstream('ws-1', { dirtyPaths: ['src/notes.ts'] });
		start();
		behind.set('ws-1', 2);

		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });

		await until(() => expect(commits).toHaveLength(1));
		await until(() => expect(activeJob().definitionId).toBe('def-update-from-main'));
		expect(pushes).toEqual([]);
	});

	it('does not reopen the same workstream within a minute', async () => {
		seedWorkstream('ws-1');
		start();
		behind.set('ws-1', 1);

		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });
		await until(() => expect(jobRuns.size).toBe(1));
		finishJob(activeJob().id, 'cancelled');
		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });

		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));
		expect(jobRuns.size).toBe(1);
	});
});

describe('the merge queue', () => {
	async function queueWithDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Added search to the header', ['src/search.ts']);
		await invoke('pull-requests.open-draft', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	it('marks ready, fixes failing checks with a job, merges once green and archives', async () => {
		await queueWithDraft();
		github.ciOutcomes = ['SUCCESS'];
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')).toMatchObject({ step: 'fixing-checks', attempts: 1 }));
		expect(github.only().isDraft).toBe(false);
		const job = activeJob();
		expect(job).toMatchObject({ definitionId: 'def-fix-checks', origin: 'merge-queue' });
		expect(ship('ws-1')?.activeJobRunId).toBe(job.id);
		expect(jobContexts.get(job.id)).toContain('Blocking check details: test: FAILURE');
		expect(jobContexts.get(job.id)).toContain('REMOTE_RECORD {"kind":"check_run"');

		finishJob(job.id, 'succeeded', { dirtyPaths: ['src/search.ts'] });

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(commits.at(-1)).toMatchObject({
			workstreamId: 'ws-1',
			message: 'Fix failing checks',
			runId: job.agentRunId,
		});
		expect(github.only().state).toBe('MERGED');
		expect(github.calls.find((call) => call[1] === 'merge')).toContain('--squash');
		expect(shipEvents.at(-1)).toEqual({
			workstreamId: 'ws-1',
			state: null,
			merged: { pullRequestNumber: 40, pullRequestUrl: 'https://github.com/acme/app/pull/40' },
		});
		expect(await invoke('pull-requests.ship-states')).toEqual([]);
	});

	it('opens the pull request first when merge is queued without one', async () => {
		seedWorkstream('ws-1', { dirtyPaths: ['src/search.ts'] });
		start();

		const record = await invoke<ShipStateRecord>('pull-requests.queue-merge', {
			workstreamId: 'ws-1',
		});

		expect(record).toMatchObject({ phase: 'queued', attempts: 0 });
		expect(record.queuedAt).not.toBeNull();
		await until(() => expect(archived).toEqual(['ws-1']));
		expect(github.count(['pr', 'create'])).toBe(1);
		expect(github.count(['pr', 'ready'])).toBe(0);
		expect(github.only()).toMatchObject({ isDraft: false });
	});

	it('waits for the agent to go idle and ships the new work in the same pull request', async () => {
		await queueWithDraft();
		openRuns.add('ws-1');
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-agent'));
		expect(github.count(['pr', 'ready'])).toBe(0);

		finishUserRun('ws-1', 'Polished the search box', ['src/box.ts']);

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(pushes).toEqual(['ws-1', 'ws-1']);
		expect(github.pulls).toHaveLength(1);
	});

	it('polls running checks and a required review, then merges', async () => {
		await queueWithDraft();
		Object.assign(github.only(), {
			checks: [{ name: 'test', status: 'IN_PROGRESS', conclusion: '' }],
			mergeStateStatus: 'BLOCKED',
			reviewDecision: 'REVIEW_REQUIRED',
		});

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-checks'));
		const reads = github.count(['pr', 'view']);
		await until(() => expect(github.count(['pr', 'view'])).toBeGreaterThan(reads + 1));
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-review'));
		expect(archived).toEqual([]);

		Object.assign(github.only(), { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' });

		await until(() => expect(archived).toEqual(['ws-1']));
		expect([...jobRuns.values()]).toEqual([]);
	});

	it('updates a conflicting branch, resolves conflicts with a job and commits the merge', async () => {
		await queueWithDraft();
		Object.assign(github.only(), {
			isDraft: false,
			mergeable: 'CONFLICTING',
			mergeStateStatus: 'DIRTY',
		});
		pullConflicts = ['src/search.ts'];

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')?.step).toBe('updating-from-main'));
		expect(pulls).toEqual(['ws-1']);
		const job = activeJob();
		expect(job.definitionId).toBe('def-update-from-main');

		pullConflicts = [];
		finishJob(job.id, 'succeeded', { resolveConflicts: true });

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(commits.at(-1)).toMatchObject({
			message: 'Merge main into malini/ws-1',
			runId: job.agentRunId,
		});
	});

	it('hands bot threads to the agent, resolves them, and merges past human comments', async () => {
		await queueWithDraft();
		const pull = github.only();
		pull.threads = [
			{ id: 'PRRT_bot', bot: true, resolved: false },
			{ id: 'PRRT_human', bot: false, resolved: false },
		];

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')?.step).toBe('addressing-review'));
		const job = activeJob();
		const jobContext = jobContexts.get(job.id) ?? '';
		expect(jobContext).toContain('"kind":"review_thread","id":"PRRT_bot"');
		expect(jobContext).not.toContain('PRRT_human');

		finishJob(job.id, 'succeeded', {
			summary: 'Handled the empty query.\nResolved: PRRT_bot',
			dirtyPaths: ['src/search.ts'],
		});

		await until(() => expect(archived).toEqual(['ws-1']));
		const fix = commits.find((commit) => commit.runId === job.agentRunId);
		expect(fix?.message).toBe('Address review feedback');
		expect(github.replies).toEqual([`PRRT_bot: Addressed in ${fix?.sha.slice(0, 7)}.`]);
		expect(pull.threads.map((thread) => [thread.id, thread.resolved])).toEqual([
			['PRRT_bot', true],
			['PRRT_human', false],
		]);
	});

	it('asks the user to reply when a human change request blocks the merge', async () => {
		await queueWithDraft();
		Object.assign(github.only(), {
			reviewDecision: 'CHANGES_REQUESTED',
			changeRequests: [{ id: 'PRR_1', login: 'alice', bot: false }],
		});
		github.only().mergeStateStatus = 'BLOCKED';

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() =>
			expect(ship('ws-1')).toMatchObject({
				phase: 'needs-you',
				needsYou: {
					reason: 'reply-to-reviewer',
					detail: '@alice requested changes.',
					jobRunId: null,
				},
			}),
		);
		expect([...jobRuns.values()]).toEqual([]);
	});

	it('gives up after the configured attempts on the same failure', async () => {
		settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] = '2';
		await queueWithDraft();
		github.ciOutcomes = ['FAILURE', 'FAILURE'];
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')).toMatchObject({ step: 'fixing-checks', attempts: 1 }));
		finishJob(activeJob().id, 'succeeded', { dirtyPaths: ['a.ts'] });
		await until(() => expect(ship('ws-1')).toMatchObject({ step: 'fixing-checks', attempts: 2 }));
		const last = activeJob();
		finishJob(last.id, 'failed');

		await until(() =>
			expect(ship('ws-1')).toMatchObject({
				phase: 'needs-you',
				needsYou: { reason: 'fix-gave-up', jobRunId: last.id },
			}),
		);
		expect(jobRuns.size).toBe(2);
		expect(github.only().state).toBe('OPEN');
	});

	it('retitles from a fix that changed no code and waits for the check the title reruns', async () => {
		await queueWithDraft();
		const failedAt = new Date(Date.now() - 60_000).toISOString();
		github.only().checks = [
			{ name: 'conventional', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: failedAt },
		];
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));

		finishJob(activeJob().id, 'succeeded', {
			summary: 'Only the title fails the check.\n\nPull request: feat: add search to the header',
		});

		await until(() => expect(github.only().title).toBe('feat: add search to the header'));
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-checks'));
		github.only().checks = [
			{
				name: 'conventional',
				status: 'COMPLETED',
				conclusion: 'SUCCESS',
				completedAt: new Date().toISOString(),
			},
		];
		await until(() => expect(archived).toEqual(['ws-1']));
		expect(jobRuns.size).toBe(1);
		expect(pushes).toEqual(['ws-1']);
	});

	it('stops for you once a fix changed nothing and no failing check runs again', async () => {
		await queueWithDraft();
		const failedAt = new Date(Date.now() - 60_000).toISOString();
		github.only().checks = [
			{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: failedAt },
		];
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));
		const job = activeJob();

		finishJob(job.id, 'succeeded', { summary: 'The test is flaky, so I changed nothing.' });
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-checks'));
		clockOffsetMs = 60_000;

		await until(() =>
			expect(ship('ws-1')).toMatchObject({
				phase: 'needs-you',
				needsYou: {
					reason: 'fix-gave-up',
					detail: 'The failing checks did not run again after the last fix.',
					jobRunId: job.id,
				},
			}),
		);
		expect(jobRuns.size).toBe(1);
	});

	it('spends no fix attempt on a job that malini closing interrupted', async () => {
		settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] = '1';
		await queueWithDraft();
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')).toMatchObject({ step: 'fixing-checks', attempts: 1 }));

		finishJob(activeJob().id, 'failed', { summary: JOB_INTERRUPTED_DETAIL });

		await until(() => expect(jobRuns.size).toBe(2));
		await until(() =>
			expect(ship('ws-1')).toMatchObject({ phase: 'queued', step: 'fixing-checks', attempts: 1 }),
		);
	});

	it('backs off on transient GitHub errors and recovers', async () => {
		await queueWithDraft();
		github.outage = 3;

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() => expect(ship('ws-1')?.lastError).toMatch(/Couldn't reach GitHub/u));
		expect(ship('ws-1')?.nextAttemptAt).not.toBeNull();
		await until(() => expect(archived).toEqual(['ws-1']));
		const errors = shipEvents.flatMap((event) => (event.state?.lastError ? [event.state] : []));
		const delays = errors.map(
			(state) => Date.parse(state.nextAttemptAt ?? '') - Date.parse(state.updatedAt),
		);
		expect(delays.length).toBeGreaterThanOrEqual(2);
		expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
	});

	it('asks to reconnect GitHub when credentials are rejected', async () => {
		await queueWithDraft();
		github.authRejected = true;

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });

		await until(() =>
			expect(ship('ws-1')).toMatchObject({
				phase: 'needs-you',
				needsYou: { reason: 'github-reconnect' },
			}),
		);
	});

	it('cancels back to draft, stopping the running job, and retries from needs-you', async () => {
		await queueWithDraft();
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));
		const job = activeJob();

		const cancelled = await invoke<ShipStateRecord>('pull-requests.cancel-merge', {
			workstreamId: 'ws-1',
		});

		expect(cancelled).toMatchObject({
			phase: 'draft',
			step: null,
			queuedAt: null,
			activeJobRunId: null,
		});
		expect(jobRuns.get(job.id)?.status).toBe('cancelled');
		expect(github.only().state).toBe('OPEN');
		expect(await invoke('pull-requests.cancel-merge', { workstreamId: 'ws-2' })).toBeNull();

		github.authRejected = true;
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.phase).toBe('needs-you'));
		github.authRejected = false;
		github.ciOutcomes = ['SUCCESS'];
		github.pushed('malini/ws-1', github.only().headRefOid);

		const retried = await invoke<ShipStateRecord>('pull-requests.retry-merge', {
			workstreamId: 'ws-1',
		});

		expect(retried).toMatchObject({ phase: 'queued', needsYou: null, attempts: 0 });
		await until(() => expect(archived).toEqual(['ws-1']));
	});

	it('resumes a queued merge after a restart without dispatching a second job', async () => {
		await queueWithDraft();
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));
		const job = activeJob();
		platform.dispose();

		context = {
			...context,
			commands: new CommandRegistry(),
			events: createEventBus({ forwardToWindows: false }),
		};
		context.events.subscribe('pull-requests:ship-changed', (event) => shipEvents.push(event));
		defineFakes();
		start();
		await new Promise((resolve) => setTimeout(resolve, DELAYS.agentPollMs * 2));
		expect(jobRuns.size).toBe(1);

		github.ciOutcomes = ['SUCCESS'];
		finishJob(job.id, 'succeeded', { dirtyPaths: ['src/search.ts'] });

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(jobRuns.size).toBe(1);
	});

	it('merges whichever queued pull request is ready first', async () => {
		seedWorkstream('ws-1', { dirtyPaths: ['a.ts'] });
		seedWorkstream('ws-2', { dirtyPaths: ['b.ts'] });
		start();
		openRuns.add('ws-1');

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await new Promise((resolve) => setTimeout(resolve, 5));
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-2' });

		await until(() => expect(archived).toEqual(['ws-2']));
		expect(ship('ws-1')?.step).toBe('waiting-for-agent');

		finishUserRun('ws-1', 'Done', []);

		await until(() => expect(archived).toEqual(['ws-2', 'ws-1']));
	});

	it('drops the queue state of a workstream removed elsewhere', async () => {
		await queueWithDraft();
		openRuns.add('ws-1');
		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-agent'));

		context.events.emit('repositories:workstream-removed', {
			workstreamId: 'ws-1',
			worktreePath: '',
			deleted: true,
		});

		expect(await invoke('pull-requests.ship-states')).toEqual([]);
	});
});
