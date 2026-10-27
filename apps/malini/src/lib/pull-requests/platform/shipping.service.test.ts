import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	APP_STARTED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
} from '$contract/events';
import {
	JOB_INTERRUPTED_DETAIL,
	type JobDefinitionRecord,
	type JobRunRecord,
	type JobRunStatus,
	type RunJobArgs,
} from '$contract/jobs';
import {
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	type ShipButton,
	type ShipChangedEvent,
	type ShipStateRecord,
} from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { all } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { workstreamPath } from '$main/git/paths';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { startEventLog } from '$lib/jobs/platform/event-log.service';
import {
	getBuiltinJobDefinition,
	insertJobDefinition,
} from '$lib/jobs/platform/job-definitions.repository';
import { insertJobRun, saveJobRun } from '$lib/jobs/platform/job-runs.repository';
import { createJobSchedules, type JobSchedules } from '$lib/jobs/platform/job-schedules.service';
import type { PullRequestsPlatform } from '../pull-requests.platform';
import type { GhRunner } from './pull-requests.service';
import { registerPullRequests } from './register';
import { getShip } from './ship.repository';

const DELAYS = {
	idleDebounceMs: 40,
	checksPollMs: 20,
	reviewPollMs: 20,
	githubPollMs: 20,
	backoffBaseMs: 40,
	backoffCapMs: 160,
};

const SETTLE_MS = 150;

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
let eventLog: { dispose(): void } | null;
let clock: JobSchedules | null;
let worktrees: Map<string, WorktreeStatus>;
let openRuns: Set<string>;
let jobRuns: Map<string, JobRunRecord>;
let jobContexts: Map<string, string>;
let jobCauses: Map<string, number | undefined>;
let settings: Record<string, string>;
let shipEvents: ShipChangedEvent[];
let commits: { workstreamId: string; message: string; runId: string | null; sha: string }[];
let pushes: string[];
let pulls: string[];
let archived: string[];
let pullConflicts: string[];
let shaCounter: number;
let clockOffsetMs: number;

const DEFINITIONS: JobDefinitionRecord[] = (
	['fix-checks', 'update-from-main', 'resolve-conflicts', 'address-review'] as const
).map((builtin) => ({
	id: `def-${builtin}`,
	name: builtin,
	instructions: `Do ${builtin}.`,
	model: 'anthropic/claude-sonnet-4-6',
	effort: 'medium',
	runsIn: 'workstream',
	skills: [],
	builtin,
	trigger: null,
	thenJobId: null,
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
	context.events.emit('chat:turn-finished', {
		workstreamId,
		sessionId: `session-${workstreamId}`,
		runId,
		status: 'succeeded',
		outcome: null,
		needs: null,
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
	ended(finished);
}

function ended(run: JobRunRecord): void {
	jobRuns.set(run.id, run);
	saveJobRun(db, run);
	context.events.emit('jobs:run-changed', { run });
	context.events.emit('jobs:run-finished', { run });
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
	commands.define('chat.workstream-has-working-run', (args: unknown) =>
		openRuns.has(String(Reflect.get(Object(args), 'workstreamId'))),
	);
	commands.define('app.list-settings', () => ({ ...settings }));
	commands.define('jobs.run', async (args: RunJobArgs) => {
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
			scope: null,
			sessionId,
			agentRunId,
			origin: args.origin ?? 'manual',
			status: 'running',
			detail: null,
			parentRunId: args.parentRunId ?? null,
			chatSessionId: args.chatSessionId ?? null,
			chatAfterRunId: null,
			chainId: `job-${index}`,
			requests: 1,
			createdAt: new Date(Date.now() + index).toISOString(),
			startedAt: null,
			finishedAt: null,
		};
		jobRuns.set(run.id, run);
		insertJobRun(db, run, args.context ?? null);
		jobContexts.set(run.id, args.context ?? '');
		jobCauses.set(run.id, args.causeEventId);
		events.emit('jobs:run-changed', { run });
		events.emit('jobs:run-started', { run });
		return run;
	});
	commands.define('jobs.cancel-run', (args: unknown) => {
		const id = String(Reflect.get(Object(args), 'jobRunId'));
		const run = jobRuns.get(id);
		if (!run) throw new Error('not found');
		const cancelled: JobRunRecord = { ...run, status: 'cancelled' };
		ended(cancelled);
		return cancelled;
	});
}

function recordShipEvents(): void {
	context.events.subscribe(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, (event) => shipEvents.push(event));
	context.events.subscribe(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, (event) => {
		if ('state' in event) shipEvents.push(event);
	});
}

function seedDefinitions(): void {
	for (const definition of DEFINITIONS) insertJobDefinition(db, definition);
}

function start(delays: typeof DELAYS = DELAYS): void {
	const now = (): number => Date.now() + clockOffsetMs;
	const shipping = registerPullRequests(context, {
		runner: github.run,
		ship: { delays, now },
	});
	platform = shipping;
	eventLog = startEventLog(
		context,
		() => {},
		(event) => shipping.handle(event),
	);
	clock = createJobSchedules(context, () => {}, { alarmCheckMs: 10, now });
	clock.start();
	context.events.emit(APP_STARTED_CHANNEL, { version: context.appVersion });
}

function stop(): void {
	clock?.dispose();
	clock = null;
	eventLog?.dispose();
	eventLog = null;
	platform.dispose();
}

function click(workstreamId: string, button: ShipButton): Promise<ShipStateRecord | null> {
	return invoke<ShipStateRecord | null>('pull-requests.button-clicked', { workstreamId, button });
}

function readPullRequest(): Promise<unknown> {
	return invoke('pull-requests.status', {
		repoId: 'p-1',
		workstreamId: 'ws-1',
		head: 'malini/ws-1',
		base: 'main',
	});
}

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
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

function readsLogged(): { id: number; payload: Record<string, unknown> }[] {
	return all<{ id: number; payload: string }>(
		db,
		'SELECT id, payload FROM event_log WHERE channel = ? ORDER BY id',
		PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	).map((row) => ({ id: row.id, payload: JSON.parse(row.payload) }));
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
	jobCauses = new Map();
	settings = {};
	shipEvents = [];
	commits = [];
	pushes = [];
	pulls = [];
	archived = [];
	pullConflicts = [];
	shaCounter = 0;
	eventLog = null;
	clock = null;
	clockOffsetMs = 0;
	runCounter = 0;
	seedDefinitions();
	recordShipEvents();
	defineFakes();
});

afterEach(() => {
	clock?.dispose();
	eventLog?.dispose();
	platform?.dispose();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

describe('opening a draft', () => {
	it('commits, pushes and opens a draft pull request with generated text', async () => {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);

		const record = await click('ws-1', 'draft');

		expect(record).toMatchObject({ phase: 'draft', step: 'opening-draft' });
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
		expect(commits).toMatchObject([{ workstreamId: 'ws-1', runId: 'user-run-1' }]);
		expect(pushes).toEqual(['ws-1']);
		expect(github.only()).toMatchObject({ isDraft: true, title: 'Add search to the header' });
		expect(ship('ws-1')?.pullRequestUrl).toBe('https://github.com/acme/app/pull/40');
	});

	it('refuses with a typed error when there is nothing to ship and no pull request', async () => {
		seedWorkstream('ws-1', { hasUpstream: true });
		start();

		await expect(click('ws-1', 'draft')).rejects.toMatchObject({
			name: 'ShipError',
			kind: 'nothing-to-ship',
		});
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

		await click('ws-1', 'draft');

		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 12, step: null }));
		expect(github.count(['pr', 'create'])).toBe(0);
		expect(pushes).toEqual([]);
	});
});

describe('pushing automatically', () => {
	async function openDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);
		await click('ws-1', 'draft');
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	it('pushes once the agent goes idle and retitles a title the user left alone', async () => {
		await openDraft();
		openRuns.add('ws-1');
		finishUserRun('ws-1', 'Commit: Add fuzzy matching to search', ['src/fuzzy.ts']);
		openRuns.add('ws-1');
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));
		expect(pushes).toEqual(['ws-1']);

		openRuns.delete('ws-1');
		finishUserRun('ws-1', 'Commit: Rank exact matches first', []);

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		expect(commits).toHaveLength(2);
		await until(() => expect(github.only().title).toBe('Rank exact matches first'));
		await until(() => expect(ship('ws-1')).toMatchObject({ phase: 'draft', step: null }));
	});

	it('keeps a title the user edited on GitHub', async () => {
		await openDraft();
		github.only().title = 'My own title';

		finishUserRun('ws-1', 'Commit: Add fuzzy matching to search', ['src/fuzzy.ts']);

		await until(() => expect(pushes).toEqual(['ws-1', 'ws-1']));
		await until(() => expect(ship('ws-1')?.step).toBeNull());
		expect(github.only().title).toBe('My own title');
	});

	it('commits each finished run locally and never pushes before a pull request exists', async () => {
		seedWorkstream('ws-1');
		start();
		const runId = finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);

		await until(() =>
			expect(commits).toMatchObject([{ message: 'Add search to the header', runId }]),
		);
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 3));
		expect(pushes).toEqual([]);
		expect(github.pulls).toHaveLength(0);
		expect(ship('ws-1')).toMatchObject({ phase: 'local', step: null });
	});
});

describe('before you merge', () => {
	async function openDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);
		await click('ws-1', 'draft');
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	it('starts nothing when you open a workstream, uncommitted work included', async () => {
		seedWorkstream('ws-1', { dirtyPaths: ['src/notes.ts'] });
		start();

		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));

		expect(jobRuns.size).toBe(0);
		expect(commits).toEqual([]);
		expect(pulls).toEqual([]);
	});

	it('leaves a draft behind main alone when you open it, and updates it from main only while it merges', async () => {
		await openDraft();
		github.only().mergeStateStatus = 'BEHIND';

		await readPullRequest();
		await invoke('pull-requests.workstream-opened', { workstreamId: 'ws-1' });
		await new Promise((resolve) => setTimeout(resolve, DELAYS.idleDebounceMs * 2));
		expect(jobRuns.size).toBe(0);
		expect(pulls).toEqual([]);

		await click('ws-1', 'merge');
		await until(() => expect(archived).toEqual(['ws-1']));
		expect(pulls).toEqual(['ws-1']);
		expect(jobRuns.size).toBe(0);
	});

	it('addresses changes a reviewer requested while you work, and records the review', async () => {
		await openDraft();
		const pull = github.only();
		Object.assign(pull, {
			reviewDecision: 'CHANGES_REQUESTED',
			changeRequests: [{ id: 'PRR_1', login: 'alice', bot: false }],
			threads: [{ id: 'PRRT_human', bot: false, resolved: false }],
		});

		await readPullRequest();

		await until(() => expect(ship('ws-1')?.step).toBe('addressing-review'));
		const job = activeJob();
		const jobContext = jobContexts.get(job.id) ?? '';
		expect(jobContext).toContain('"kind":"requested_change_review","id":"PRR_1"');
		expect(jobContext).toContain('"kind":"review_thread","id":"PRRT_human"');
		finishJob(job.id, 'succeeded', {
			summary: 'Added the missing test.\nResolved: PRRT_human',
			dirtyPaths: ['src/search.ts'],
		});

		await until(() => expect(pull.threads[0]?.resolved).toBe(true));
		await until(() => expect(ship('ws-1')).toMatchObject({ phase: 'draft', step: null }));
		expect(getShip(db, 'ws-1')?.addressedReviews).toEqual(['PRR_1']);
		expect(jobRuns.size).toBe(1);
	});
});

describe('shipping a queued merge', () => {
	async function queueWithDraft(): Promise<void> {
		seedWorkstream('ws-1');
		start();
		finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);
		await click('ws-1', 'draft');
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
	}

	it('marks ready, fixes failing checks with a job, merges once green and archives', async () => {
		await queueWithDraft();
		github.ciOutcomes = ['SUCCESS'];
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

		await click('ws-1', 'merge');

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

	it('logs each new read of the pull request once and names it as the cause of its jobs', async () => {
		await queueWithDraft();
		github.ciOutcomes = ['SUCCESS'];
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

		await click('ws-1', 'merge');

		await until(() => expect(ship('ws-1')).toMatchObject({ step: 'fixing-checks' }));
		const job = activeJob();
		const failing = readsLogged().at(-1);
		expect(failing?.payload).toMatchObject({
			workstreamId: 'ws-1',
			pullRequestNumber: 40,
			state: 'open',
			checks: 'failed',
			failingChecks: ['test'],
		});
		expect(jobCauses.get(job.id)).toBe(failing?.id);
		await invoke('pull-requests.status', {
			repoId: 'p-1',
			workstreamId: 'ws-1',
			head: 'malini/ws-1',
			base: 'main',
		});
		expect(readsLogged().at(-1)?.id).toBe(failing?.id);

		finishJob(job.id, 'succeeded', { dirtyPaths: ['src/search.ts'] });

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(readsLogged().map(({ payload }) => [payload['state'], payload['checks']])).toEqual([
			['draft', 'failed'],
			['open', 'failed'],
			['open', 'success'],
			['merged', 'success'],
		]);
	});

	it('logs your click on Merge and moves the merge only once it hears that click', async () => {
		await queueWithDraft();
		eventLog?.dispose();
		const clicks: unknown[] = [];
		context.events.subscribe(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, (payload) =>
			clicks.push(payload),
		);

		await click('ws-1', 'merge');
		await settle();

		expect(clicks).toEqual([
			{
				workstreamId: 'ws-1',
				button: 'merge',
				state: expect.objectContaining({ phase: 'queued', step: null }),
			},
		]);
		expect(github.only().isDraft).toBe(true);
		await platform.handle({
			id: null,
			channel: PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
			payload: clicks[0],
			chainId: null,
			cause: null,
		});
		await until(() => expect(archived).toEqual(['ws-1']));
	});

	it('merges what the Merge job queued once that job finishes, without a click', async () => {
		await queueWithDraft();
		const before = shipEvents.length;

		await invoke('pull-requests.queue-merge', { workstreamId: 'ws-1' });
		await settle();

		expect(shipEvents.slice(before)).toEqual([
			{ workstreamId: 'ws-1', state: expect.objectContaining({ phase: 'queued', step: null }) },
		]);
		expect(github.only().isDraft).toBe(true);
		const definition = getBuiltinJobDefinition(db, 'merge');
		if (!definition) throw new Error('the Merge job is missing');
		const merge: JobRunRecord = {
			id: 'merge-run',
			definitionId: definition.id,
			title: 'Merge',
			workstreamId: 'ws-1',
			repositoryId: null,
			scope: null,
			sessionId: null,
			agentRunId: null,
			origin: 'then',
			status: 'succeeded',
			detail: 'Queued to merge: https://github.com/acme/app/pull/40',
			parentRunId: null,
			chatSessionId: null,
			chatAfterRunId: null,
			chainId: 'merge-run',
			requests: 1,
			createdAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
		};
		insertJobRun(db, merge, null);
		context.events.emit('jobs:run-finished', { run: merge });

		await until(() => expect(archived).toEqual(['ws-1']));
	});

	it('starts nothing from a read that changed nothing', async () => {
		await queueWithDraft();
		Object.assign(github.only(), {
			mergeStateStatus: 'BLOCKED',
			reviewDecision: 'REVIEW_REQUIRED',
		});
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-review'));
		const logged = readsLogged().length;
		const reads = github.count(['pr', 'view']);

		await until(() => expect(github.count(['pr', 'view'])).toBeGreaterThan(reads + 3));

		expect(readsLogged()).toHaveLength(logged);
		expect(jobRuns.size).toBe(0);
		expect(ship('ws-1')?.step).toBe('waiting-for-review');
	});

	it('answers a second change request whose counts match the first, naming its own read', async () => {
		await queueWithDraft();
		const pull = github.only();
		Object.assign(pull, {
			reviewDecision: 'CHANGES_REQUESTED',
			changeRequests: [{ id: 'PRR_1', login: 'alice', bot: false }],
			threads: [{ id: 'PRRT_1', bot: false, resolved: false }],
		});
		await readPullRequest();
		await until(() => expect(ship('ws-1')?.step).toBe('addressing-review'));
		const first = activeJob();
		finishJob(first.id, 'succeeded', {
			summary: 'Done.\nResolved: PRRT_1',
			dirtyPaths: ['src/search.ts'],
		});
		await until(() => expect(getShip(db, 'ws-1')?.addressedReviews).toEqual(['PRR_1']));
		await until(() => expect(ship('ws-1')?.step).toBeNull());
		Object.assign(pull, {
			changeRequests: [{ id: 'PRR_2', login: 'alice', bot: false }],
			threads: [{ id: 'PRRT_2', bot: false, resolved: false }],
		});

		await readPullRequest();

		await until(() => expect(jobRuns.size).toBe(2));
		const second = activeJob();
		const read = readsLogged().at(-1);
		expect(read?.payload).toMatchObject({
			unresolvedThreads: 1,
			changeRequests: [{ id: 'PRR_2', by: 'alice', bot: false }],
		});
		expect(jobCauses.get(second.id)).toBe(read?.id);
		expect(jobContexts.get(second.id)).toContain('"id":"PRR_2"');
	});

	it('merges as soon as a read of the pull request shows its checks passed', async () => {
		seedWorkstream('ws-1');
		start({ ...DELAYS, checksPollMs: 60_000 });
		finishUserRun('ws-1', 'Commit: Add search to the header', ['src/search.ts']);
		await click('ws-1', 'draft');
		await until(() => expect(ship('ws-1')).toMatchObject({ pullRequestNumber: 40, step: null }));
		Object.assign(github.only(), {
			checks: [{ name: 'test', status: 'IN_PROGRESS', conclusion: '' }],
			mergeStateStatus: 'BLOCKED',
		});
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-checks'));

		Object.assign(github.only(), {
			checks: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
			mergeStateStatus: 'CLEAN',
		});
		await invoke('pull-requests.status', {
			repoId: 'p-1',
			workstreamId: 'ws-1',
			head: 'malini/ws-1',
			base: 'main',
		});

		await until(() => expect(archived).toEqual(['ws-1']));
	});

	it('opens the pull request first when merge is queued without one', async () => {
		seedWorkstream('ws-1', { dirtyPaths: ['src/search.ts'] });
		start();

		const record = await click('ws-1', 'merge');

		expect(record).toMatchObject({ phase: 'queued', attempts: 0 });
		expect(record?.queuedAt).not.toBeNull();
		await until(() => expect(archived).toEqual(['ws-1']));
		expect(github.count(['pr', 'create'])).toBe(1);
		expect(github.count(['pr', 'ready'])).toBe(0);
		expect(github.only()).toMatchObject({ isDraft: false });
	});

	it('waits for the agent to go idle and ships the new work in the same pull request', async () => {
		await queueWithDraft();
		openRuns.add('ws-1');
		await click('ws-1', 'merge');
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

		await click('ws-1', 'merge');

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

		await click('ws-1', 'merge');

		await until(() => expect(ship('ws-1')?.step).toBe('resolving-conflicts'));
		expect(pulls).toEqual(['ws-1']);
		const job = activeJob();
		expect(job.definitionId).toBe('def-resolve-conflicts');

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

		await click('ws-1', 'merge');

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

	it('addresses a human change request with a job once, then merges', async () => {
		await queueWithDraft();
		const pull = github.only();
		Object.assign(pull, {
			reviewDecision: 'CHANGES_REQUESTED',
			changeRequests: [{ id: 'PRR_1', login: 'alice', bot: false }],
			threads: [{ id: 'PRRT_human', bot: false, resolved: false }],
		});
		pull.mergeStateStatus = 'BLOCKED';

		await click('ws-1', 'merge');

		await until(() => expect(ship('ws-1')?.step).toBe('addressing-review'));
		const job = activeJob();
		expect(jobContexts.get(job.id)).toContain('"kind":"requested_change_review","id":"PRR_1"');
		finishJob(job.id, 'succeeded', {
			summary: 'Added the missing test.\nResolved: PRRT_human',
			dirtyPaths: ['src/search.ts'],
		});

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(jobRuns.size).toBe(1);
		expect(pull.threads[0]?.resolved).toBe(true);
	});

	it('asks you to reply to a stray human comment, then picks the merge up once it is resolved', async () => {
		await queueWithDraft();
		const pull = github.only();
		pull.threads = [{ id: 'PRRT_question', bot: false, resolved: false }];
		pull.mergeStateStatus = 'BLOCKED';

		await click('ws-1', 'merge');

		await until(() =>
			expect(ship('ws-1')).toMatchObject({
				phase: 'needs-you',
				needsYou: { reason: 'reply-to-reviewer', jobRunId: null },
			}),
		);
		expect(jobRuns.size).toBe(0);
		pull.threads = [{ id: 'PRRT_question', bot: false, resolved: true }];
		pull.mergeStateStatus = 'CLEAN';

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(github.only().state).toBe('MERGED');
	});

	it('archives a stopped merge once the pull request merged on GitHub', async () => {
		await queueWithDraft();
		const pull = github.only();
		pull.threads = [{ id: 'PRRT_question', bot: false, resolved: false }];
		pull.mergeStateStatus = 'BLOCKED';
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.phase).toBe('needs-you'));

		pull.state = 'MERGED';

		await until(() => expect(archived).toEqual(['ws-1']));
		expect(github.count(['pr', 'merge'])).toBe(0);
	});

	it('gives up after the configured attempts on the same failure', async () => {
		settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] = '2';
		await queueWithDraft();
		github.ciOutcomes = ['FAILURE', 'FAILURE'];
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

		await click('ws-1', 'merge');

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
		await click('ws-1', 'merge');
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
		await click('ws-1', 'merge');
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
		await click('ws-1', 'merge');
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

		await click('ws-1', 'merge');

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

		await click('ws-1', 'merge');

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
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));
		const job = activeJob();

		const cancelled = await click('ws-1', 'cancel');

		expect(cancelled).toMatchObject({
			phase: 'draft',
			step: null,
			queuedAt: null,
			activeJobRunId: null,
		});
		expect(jobRuns.get(job.id)?.status).toBe('cancelled');
		expect(github.only().state).toBe('OPEN');
		expect(await click('ws-2', 'cancel')).toBeNull();

		github.authRejected = true;
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.phase).toBe('needs-you'));
		github.authRejected = false;
		github.ciOutcomes = ['SUCCESS'];
		github.pushed('malini/ws-1', github.only().headRefOid);

		const retried = await click('ws-1', 'retry');

		expect(retried).toMatchObject({ phase: 'queued', needsYou: null, attempts: 0 });
		await until(() => expect(archived).toEqual(['ws-1']));
	});

	it('resumes a queued merge after a restart without dispatching a second job', async () => {
		await queueWithDraft();
		github.only().checks = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.step).toBe('fixing-checks'));
		const job = activeJob();
		stop();

		context = {
			...context,
			commands: new CommandRegistry(),
			events: createEventBus({ forwardToWindows: false }),
		};
		recordShipEvents();
		defineFakes();
		start();
		await settle();
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

		await click('ws-1', 'merge');
		await new Promise((resolve) => setTimeout(resolve, 5));
		await click('ws-2', 'merge');

		await until(() => expect(archived).toEqual(['ws-2']));
		expect(ship('ws-1')?.step).toBe('waiting-for-agent');

		finishUserRun('ws-1', 'Done', []);

		await until(() => expect(archived).toEqual(['ws-2', 'ws-1']));
	});

	it('drops the queue state of a workstream removed elsewhere', async () => {
		await queueWithDraft();
		openRuns.add('ws-1');
		await click('ws-1', 'merge');
		await until(() => expect(ship('ws-1')?.step).toBe('waiting-for-agent'));

		context.events.emit('repositories:workstream-removed', {
			workstreamId: 'ws-1',
			worktreePath: '',
			deleted: true,
		});

		await until(async () => expect(await invoke('pull-requests.ship-states')).toEqual([]));
	});
});

describe('Draft all and Merge all', () => {
	it('logs the click on the chat and runs Merge in each workstream it names, for that chat', async () => {
		seedWorkstream('lead');
		seedWorkstream('ws-1');
		seedWorkstream('ws-2');
		start();
		const merge = getBuiltinJobDefinition(db, 'merge');

		await expect(
			invoke('pull-requests.button-clicked', {
				workstreamId: 'lead',
				button: 'merge-all',
				workstreamIds: ['ws-1', 'ws-2'],
				chatSessionId: 'session-lead',
			}),
		).resolves.toBeNull();
		await until(() => expect(jobRuns.size).toBe(2));

		const clicks = all<{ id: number; workstream_id: string }>(
			db,
			'SELECT id, workstream_id FROM event_log WHERE channel = ?',
			PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
		);
		expect(clicks).toEqual([{ id: expect.any(Number), workstream_id: 'lead' }]);
		expect(
			[...jobRuns.values()]
				.map((run) => [
					run.workstreamId,
					run.definitionId,
					run.origin,
					run.chatSessionId,
					jobCauses.get(run.id),
				])
				.sort(),
		).toEqual([
			['ws-1', merge?.id, 'merge-queue', 'session-lead', clicks[0]?.id],
			['ws-2', merge?.id, 'merge-queue', 'session-lead', clicks[0]?.id],
		]);
		expect(getShip(db, 'lead')).toBeNull();
	});

	it('refuses a Draft all that names no workstream', async () => {
		start();

		await expect(
			invoke('pull-requests.button-clicked', {
				workstreamId: 'lead',
				button: 'draft-all',
				workstreamIds: [],
				chatSessionId: null,
			}),
		).rejects.toThrow('`workstreamIds` must be a non-empty list of non-empty strings');
		await settle();
		expect(jobRuns.size).toBe(0);
	});
});
