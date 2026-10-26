import { describe, expect, it } from 'vitest';
import type {
	PullRequestCheckDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
	ReviewThreadDto,
} from '$contract/repositories';
import {
	DEFAULT_SHIP_DELAYS,
	addressedChangeRequests,
	clampedFixAttempts,
	needsReviewFeedback,
	nextMergeQueueMove,
	pullRequestChange,
	reviewFeedbackToAddress,
	reviewSignature,
	reviewToAddress,
	shipBackoffMs,
	type MergeQueueSnapshot,
} from './merge-queue';

function check(name: string, conclusion: string | null, state = 'COMPLETED'): PullRequestCheckDto {
	return {
		name,
		appId: null,
		state,
		conclusion,
		required: null,
		url: null,
		startedAt: null,
		completedAt: null,
		notStartedReason: null,
	};
}

function pullRequest(overrides: Partial<PullRequestStatusDto> = {}): PullRequestStatusDto {
	return {
		state: 'open',
		number: 7,
		url: 'https://github.com/acme/app/pull/7',
		title: 'Add search',
		draft: false,
		headRef: 'malini/ws-1',
		baseRef: 'main',
		headSha: 'a'.repeat(40),
		includesLocalHead: null,
		mergeable: true,
		mergeableState: 'CLEAN',
		behindBase: 0,
		checksState: 'success',
		checks: [check('test', 'SUCCESS')],
		viewerCanMerge: true,
		allowedMergeMethods: ['squash', 'merge'],
		defaultMergeMethod: 'squash',
		reviewDecision: null,
		unresolvedReviewThreadCount: 0,
		updatedAt: null,
		...overrides,
	};
}

function thread(id: string, bot: boolean, login = 'alice'): ReviewThreadDto {
	return {
		id,
		path: 'src/a.ts',
		line: 1,
		startLine: null,
		side: 'RIGHT',
		startSide: null,
		subjectType: 'LINE',
		outdated: false,
		comments: [
			{
				id: `${id}-c`,
				authorLogin: bot ? 'coderabbitai[bot]' : login,
				authorIsBot: bot,
				body: 'Rename this.',
				createdAt: '',
				updatedAt: '',
			},
		],
	};
}

function feedback(
	threads: readonly ReviewThreadDto[],
	changeRequests: readonly { id: string; login: string; bot: boolean }[] = [],
): ReviewFeedbackDto {
	return {
		unresolvedThreads: [...threads],
		unresolvedThreadsComplete: true,
		requestedChangeReviews: changeRequests.map(({ id, login, bot }) => ({
			id,
			authorLogin: login,
			authorIsBot: bot,
			body: 'Please change',
			submittedAt: '',
			updatedAt: '',
		})),
		requestedChangeReviewsComplete: true,
		truncated: false,
	};
}

function queued(overrides: Partial<MergeQueueSnapshot> = {}): MergeQueueSnapshot {
	return {
		phase: 'queued',
		pushRequested: false,
		updateRequested: false,
		reviewRequested: false,
		addressedReviews: [],
		behindBase: null,
		pullRequestNumber: 7,
		idle: true,
		job: null,
		lastJobRunId: 'job-last',
		lastJobBuiltin: null,
		settledJob: null,
		worktree: {
			dirtyPaths: [],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: 0,
			hasUpstream: true,
			operationInProgress: null,
		},
		threadResolutionRunId: null,
		failureSignature: null,
		fixSucceededAt: null,
		attempts: 0,
		fixAttemptLimit: 3,
		backoffUntil: null,
		now: 1_000,
		pullRequest: pullRequest(),
		reviewFeedback: null,
		...overrides,
	};
}

const worktree = queued().worktree;

describe('a draft workstream', () => {
	const draft = (overrides: Partial<MergeQueueSnapshot> = {}): MergeQueueSnapshot =>
		queued({ phase: 'draft', pushRequested: true, pullRequest: null, ...overrides });

	it('does nothing until an agent run or the user asks for a push', () => {
		expect(nextMergeQueueMove(draft({ pushRequested: false }))).toEqual({
			kind: 'idle',
			problem: null,
		});
	});

	it('waits for the agent, then opens the draft pull request when none exists', () => {
		expect(nextMergeQueueMove(draft({ idle: false, pullRequestNumber: null }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(nextMergeQueueMove(draft({ pullRequestNumber: null }))).toEqual({
			kind: 'open-draft',
		});
	});

	it('pushes unpushed work to an existing pull request, and settles when there is none', () => {
		expect(nextMergeQueueMove(draft({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } }))).toEqual({
			kind: 'push',
		});
		expect(nextMergeQueueMove(draft({ worktree: { ...worktree, ahead: 2 } }))).toEqual({
			kind: 'push',
		});
		expect(nextMergeQueueMove(draft())).toEqual({ kind: 'idle', problem: null });
	});

	it('never fixes anything: a failing pull request in a draft only gets pushes', () => {
		expect(
			nextMergeQueueMove(
				draft({ pullRequest: pullRequest({ checks: [check('test', 'FAILURE')] }) }),
			),
		).toEqual({ kind: 'idle', problem: null });
	});

	it('refuses to push in the middle of a rebase and says why', () => {
		expect(
			nextMergeQueueMove(draft({ worktree: { ...worktree, operationInProgress: 'rebase' } })),
		).toEqual({
			kind: 'idle',
			problem: 'A rebase is in progress in this workstream. Finish or abort it, then try again.',
		});
	});
});

describe('keeping a local or draft workstream current', () => {
	const local = (overrides: Partial<MergeQueueSnapshot> = {}): MergeQueueSnapshot =>
		queued({
			phase: 'local',
			pullRequestNumber: null,
			pullRequest: pullRequest({ state: 'not_open', number: null, url: null }),
			...overrides,
		});
	const merging = (paths: Partial<typeof worktree>) => ({
		...worktree,
		operationInProgress: 'merge' as const,
		...paths,
	});

	it('commits finished work locally and never pushes before a pull request exists', () => {
		expect(
			nextMergeQueueMove(
				local({ pushRequested: true, worktree: { ...worktree, dirtyPaths: ['a.ts'] } }),
			),
		).toEqual({ kind: 'commit' });
		expect(
			nextMergeQueueMove(local({ pushRequested: true, worktree: { ...worktree, ahead: 3 } })),
		).toEqual({ kind: 'idle', problem: null });
	});

	it('reads how far main moved, then commits leftover local work and updates only a workstream that is behind', () => {
		expect(nextMergeQueueMove(local({ updateRequested: true }))).toEqual({ kind: 'read-base' });
		expect(nextMergeQueueMove(local({ updateRequested: true, behindBase: 0 }))).toEqual({
			kind: 'idle',
			problem: null,
		});
		const update = {
			kind: 'run-job',
			builtin: 'update-from-main',
			signature: 'update',
			attempt: 1,
		};
		expect(nextMergeQueueMove(local({ updateRequested: true, behindBase: 4 }))).toEqual(update);
		expect(
			nextMergeQueueMove(queued({ phase: 'draft', updateRequested: true, behindBase: 4 })),
		).toEqual(update);
		expect(
			nextMergeQueueMove(
				local({
					updateRequested: true,
					behindBase: 4,
					worktree: { ...worktree, dirtyPaths: ['a.ts'] },
				}),
			),
		).toEqual({ kind: 'commit' });
		expect(
			nextMergeQueueMove(
				local({
					updateRequested: true,
					behindBase: 0,
					worktree: { ...worktree, dirtyPaths: ['a.ts'] },
				}),
			),
		).toEqual({ kind: 'idle', problem: null });
		expect(
			nextMergeQueueMove(
				queued({
					phase: 'draft',
					updateRequested: true,
					behindBase: 4,
					worktree: { ...worktree, dirtyPaths: ['a.ts'] },
				}),
			),
		).toEqual({ kind: 'idle', problem: null });
	});

	it('addresses a change request on its own while you work, once per review', () => {
		const requested = (overrides: Partial<MergeQueueSnapshot> = {}) =>
			queued({
				phase: 'draft',
				reviewRequested: true,
				pullRequest: pullRequest({ reviewDecision: 'changes_requested' }),
				reviewFeedback: feedback(
					[thread('PRRT_human', false)],
					[{ id: 'PRR_2', login: 'alice', bot: false }],
				),
				...overrides,
			});
		expect(nextMergeQueueMove(requested())).toEqual({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":["PRR_2"],"threads":["PRRT_human"]}',
			attempt: 1,
		});
		expect(nextMergeQueueMove(requested({ addressedReviews: ['PRR_2'] }))).toEqual({
			kind: 'idle',
			problem: null,
		});
		expect(nextMergeQueueMove(requested({ pullRequest: null }))).toEqual({
			kind: 'read-pull-request',
		});
		expect(
			nextMergeQueueMove(requested({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } })),
		).toEqual({ kind: 'idle', problem: null });
		expect(nextMergeQueueMove(requested({ idle: false }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(
			nextMergeQueueMove(
				requested({ threadResolutionRunId: 'run-fix', addressedReviews: ['PRR_2'] }),
			),
		).toEqual({ kind: 'resolve-threads', agentRunId: 'run-fix' });
	});

	it('reads the pull request after main moved and never updates one that merged or closed', () => {
		const draft = (overrides: Partial<MergeQueueSnapshot>) =>
			queued({ phase: 'draft', updateRequested: true, behindBase: 4, ...overrides });
		expect(nextMergeQueueMove(draft({ pullRequest: null }))).toEqual({ kind: 'read-pull-request' });
		expect(
			nextMergeQueueMove(local({ updateRequested: true, behindBase: 4, pullRequest: null })),
		).toEqual({ kind: 'read-pull-request' });
		for (const state of ['merged', 'closed'] as const) {
			expect(nextMergeQueueMove(draft({ pullRequest: pullRequest({ state }) }))).toEqual({
				kind: 'idle',
				problem: null,
			});
			expect(
				nextMergeQueueMove(
					local({ updateRequested: true, behindBase: 4, pullRequest: pullRequest({ state }) }),
				),
			).toEqual({ kind: 'idle', problem: null });
		}
		expect(nextMergeQueueMove(draft({}))).toMatchObject({ kind: 'run-job' });
	});

	it('shows the update and conflict jobs while they run', () => {
		expect(
			nextMergeQueueMove(local({ job: { builtin: 'update-from-main', status: 'running' } })),
		).toEqual({ kind: 'wait', step: 'updating-from-main' });
		expect(
			nextMergeQueueMove(local({ job: { builtin: 'resolve-conflicts', status: 'queued' } })),
		).toEqual({ kind: 'wait', step: 'resolving-conflicts' });
	});

	it('resolves conflicts its own update left, then saves the merge, giving up quietly', () => {
		const conflicted = merging({ conflictedPaths: ['a.ts'], conflictMarkerPaths: ['a.ts'] });
		const unstaged = merging({ conflictedPaths: ['a.ts'] });
		const afterUpdate = {
			pushRequested: true,
			lastJobBuiltin: 'update-from-main' as const,
			settledJob: 'update-from-main' as const,
		};
		const afterResolve = {
			pushRequested: true,
			lastJobBuiltin: 'resolve-conflicts' as const,
			settledJob: 'resolve-conflicts' as const,
		};
		const resolve = {
			kind: 'run-job',
			builtin: 'resolve-conflicts',
			signature: 'conflicts:["a.ts"]',
			attempt: 1,
		};
		expect(nextMergeQueueMove(local({ ...afterUpdate, worktree: conflicted }))).toEqual(resolve);
		expect(nextMergeQueueMove(local({ ...afterUpdate, worktree: unstaged }))).toEqual(resolve);
		expect(nextMergeQueueMove(local({ ...afterResolve, worktree: unstaged }))).toEqual({
			kind: 'commit',
		});
		expect(
			nextMergeQueueMove(queued({ phase: 'draft', ...afterResolve, worktree: unstaged })),
		).toEqual({ kind: 'push' });
		expect(
			nextMergeQueueMove(
				local({ ...afterResolve, failureSignature: 'update', attempts: 1, worktree: conflicted }),
			),
		).toEqual(resolve);
		expect(
			nextMergeQueueMove(
				local({
					...afterResolve,
					failureSignature: 'conflicts:["a.ts"]',
					attempts: 1,
					worktree: conflicted,
				}),
			),
		).toEqual({ ...resolve, attempt: 2 });
		expect(
			nextMergeQueueMove(
				local({
					...afterResolve,
					failureSignature: 'conflicts:["a.ts"]',
					attempts: 3,
					worktree: conflicted,
				}),
			),
		).toEqual({ kind: 'idle', problem: 'Resolving conflicts did not work. Malini tried 3 times.' });
	});

	it('leaves a merge the user started alone', () => {
		expect(
			nextMergeQueueMove(
				local({ pushRequested: true, worktree: merging({ conflictedPaths: ['a.ts'] }) }),
			),
		).toEqual({
			kind: 'idle',
			problem: 'A merge is in progress in this workstream. Finish or abort it, then try again.',
		});
	});
});

describe('a queued workstream', () => {
	it('stays put while backing off from an error', () => {
		expect(nextMergeQueueMove(queued({ backoffUntil: 5_000 }))).toEqual({ kind: 'backoff' });
		expect(nextMergeQueueMove(queued({ backoffUntil: 500 }))).toMatchObject({ kind: 'merge' });
	});

	it('waits while the agent or its own job is busy, showing the job step', () => {
		expect(nextMergeQueueMove(queued({ idle: false }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(
			nextMergeQueueMove(queued({ job: { builtin: 'fix-checks', status: 'running' } })),
		).toEqual({ kind: 'wait', step: 'fixing-checks' });
		expect(
			nextMergeQueueMove(queued({ job: { builtin: 'address-review', status: 'needs-you' } })),
		).toEqual({ kind: 'wait', step: 'addressing-review' });
	});

	it('asks the user to finish a rebase or cherry-pick they started', () => {
		expect(
			nextMergeQueueMove(queued({ worktree: { ...worktree, operationInProgress: 'cherry-pick' } })),
		).toEqual({
			kind: 'needs-you',
			reason: 'operation-in-progress',
			detail: 'A cherry-pick is in progress in this workstream. Finish or abort it, then retry.',
			jobRunId: null,
		});
	});

	it('resolves conflicts a branch update left behind, then commits the merge', () => {
		const merging = { ...worktree, operationInProgress: 'merge' as const };
		expect(
			nextMergeQueueMove(queued({ worktree: { ...merging, conflictedPaths: ['b.ts', 'a.ts'] } })),
		).toEqual({
			kind: 'run-job',
			builtin: 'resolve-conflicts',
			signature: 'conflicts:["a.ts","b.ts"]',
			attempt: 1,
		});
		expect(nextMergeQueueMove(queued({ worktree: merging }))).toEqual({ kind: 'push' });
	});

	it('commits conflicts a resolve-conflicts job cleared of markers, even when it left them unstaged', () => {
		const unstaged = {
			...worktree,
			operationInProgress: 'merge' as const,
			conflictedPaths: ['a.ts'],
		};
		expect(
			nextMergeQueueMove(queued({ settledJob: 'resolve-conflicts', worktree: unstaged })),
		).toEqual({ kind: 'push' });
		expect(
			nextMergeQueueMove(queued({ settledJob: 'update-from-main', worktree: unstaged })),
		).toMatchObject({ kind: 'run-job', builtin: 'resolve-conflicts' });
		expect(
			nextMergeQueueMove(
				queued({
					settledJob: 'resolve-conflicts',
					failureSignature: 'conflicts:["a.ts"]',
					attempts: 1,
					worktree: { ...unstaged, conflictMarkerPaths: ['a.ts'] },
				}),
			),
		).toEqual({
			kind: 'run-job',
			builtin: 'resolve-conflicts',
			signature: 'conflicts:["a.ts"]',
			attempt: 2,
		});
	});

	it('opens the pull request first, then pushes pending work', () => {
		expect(nextMergeQueueMove(queued({ pullRequestNumber: null }))).toEqual({
			kind: 'open-draft',
		});
		expect(nextMergeQueueMove(queued({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } }))).toEqual(
			{ kind: 'push' },
		);
		expect(nextMergeQueueMove(queued({ worktree: { ...worktree, hasUpstream: false } }))).toEqual({
			kind: 'push',
		});
	});

	it('resolves the threads an address-review job fixed once its work is pushed', () => {
		expect(nextMergeQueueMove(queued({ threadResolutionRunId: 'run-9' }))).toEqual({
			kind: 'resolve-threads',
			agentRunId: 'run-9',
		});
	});

	it('reads the pull request only once everything local is settled', () => {
		expect(nextMergeQueueMove(queued({ pullRequest: null }))).toEqual({
			kind: 'read-pull-request',
		});
	});

	it('archives a pull request merged anywhere, and stops at one closed without merging', () => {
		expect(nextMergeQueueMove(queued({ pullRequest: pullRequest({ state: 'merged' }) }))).toEqual({
			kind: 'archive',
		});
		expect(nextMergeQueueMove(queued({ pullRequest: pullRequest({ state: 'closed' }) }))).toEqual({
			kind: 'needs-you',
			reason: 'pull-request-closed',
			detail: 'Pull request #7 was closed without merging.',
			jobRunId: null,
		});
		expect(nextMergeQueueMove(queued({ pullRequest: pullRequest({ state: 'not_open' }) }))).toEqual(
			{ kind: 'open-draft' },
		);
	});

	it('marks a draft ready before anything else on GitHub', () => {
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({ draft: true, checks: [check('test', 'FAILURE')] }),
				}),
			),
		).toEqual({ kind: 'mark-ready' });
	});

	it('updates a conflicting or behind branch', () => {
		const conflicting = pullRequest({ mergeable: false, mergeableState: 'DIRTY' });
		const behind = pullRequest({ mergeableState: 'BEHIND' });
		expect(nextMergeQueueMove(queued({ pullRequest: conflicting }))).toEqual({
			kind: 'update-branch',
		});
		expect(nextMergeQueueMove(queued({ pullRequest: behind }))).toEqual({
			kind: 'update-branch',
		});
	});

	it('runs fix-checks for failing blocking checks, ignoring optional and never-started ones', () => {
		const failing = pullRequest({
			checksState: 'failed',
			mergeableState: 'BLOCKED',
			checks: [
				check('lint', 'FAILURE'),
				check('test', 'TIMED_OUT'),
				{ ...check('optional', 'FAILURE'), required: false },
				{ ...check('billing', 'FAILURE'), notStartedReason: 'your account is locked' },
				check('build', 'SUCCESS'),
			],
		});
		expect(nextMergeQueueMove(queued({ pullRequest: failing }))).toEqual({
			kind: 'run-job',
			builtin: 'fix-checks',
			signature: 'checks:["lint","test"]',
			attempt: 1,
		});
	});

	it('counts attempts per failure signature and gives up after the limit', () => {
		const failing = pullRequest({ checksState: 'failed', checks: [check('lint', 'FAILURE')] });
		const same = 'checks:["lint"]';
		expect(
			nextMergeQueueMove(queued({ pullRequest: failing, failureSignature: same, attempts: 2 })),
		).toMatchObject({ kind: 'run-job', attempt: 3 });
		expect(
			nextMergeQueueMove(
				queued({ pullRequest: failing, failureSignature: 'checks:["test"]', attempts: 3 }),
			),
		).toMatchObject({ kind: 'run-job', attempt: 1 });
		expect(
			nextMergeQueueMove(queued({ pullRequest: failing, failureSignature: same, attempts: 3 })),
		).toEqual({
			kind: 'needs-you',
			reason: 'fix-gave-up',
			detail: 'Fixing the checks did not work. Malini tried 3 times.',
			jobRunId: 'job-last',
		});
		expect(
			nextMergeQueueMove(
				queued({ pullRequest: failing, failureSignature: same, attempts: 1, fixAttemptLimit: 1 }),
			),
		).toMatchObject({ reason: 'fix-gave-up', detail: expect.stringContaining('tried once') });
	});

	it('judges a fix only by checks that ran after it, and gives up when none run again', () => {
		const fixedAt = Date.parse('2026-10-12T11:05:00Z');
		const ranAt = (at: string): PullRequestCheckDto => ({
			...check('conventional', 'FAILURE'),
			completedAt: at,
		});
		const after = (checks: PullRequestCheckDto[], now: number): MergeQueueSnapshot =>
			queued({
				pullRequest: pullRequest({ checksState: 'failed', checks }),
				failureSignature: 'checks:["conventional"]',
				fixSucceededAt: fixedAt,
				attempts: 1,
				now,
			});

		expect(nextMergeQueueMove(after([ranAt('2026-10-12T11:04:00Z')], fixedAt + 1_000))).toEqual({
			kind: 'wait',
			step: 'waiting-for-checks',
		});
		expect(nextMergeQueueMove(after([ranAt('2026-10-12T11:04:00Z')], fixedAt + 60_000))).toEqual({
			kind: 'needs-you',
			reason: 'fix-gave-up',
			detail: 'The failing checks did not run again after the last fix.',
			jobRunId: 'job-last',
		});
		expect(
			nextMergeQueueMove(after([ranAt('2026-10-12T11:06:00Z')], fixedAt + 60_000)),
		).toMatchObject({ kind: 'run-job', attempt: 2 });
		expect(nextMergeQueueMove(after([check('conventional', 'FAILURE')], fixedAt))).toMatchObject({
			kind: 'run-job',
			attempt: 2,
		});
	});

	it('waits for running checks', () => {
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({
						checksState: 'pending',
						checks: [check('test', null, 'IN_PROGRESS')],
					}),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-checks' });
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({
						checksState: 'failed',
						checks: [
							{ ...check('optional', 'FAILURE'), required: false },
							check('test', null, 'QUEUED'),
						],
					}),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-checks' });
	});

	it('hands bot threads and every change request to the agent, never stray human comments', () => {
		const withThreads = queued({
			pullRequest: pullRequest({ unresolvedReviewThreadCount: 2 }),
			reviewFeedback: feedback([thread('PRRT_human', false), thread('PRRT_bot', true)]),
		});
		expect(nextMergeQueueMove(withThreads)).toEqual({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":[],"threads":["PRRT_bot"]}',
			attempt: 1,
		});
		const botRequest = queued({
			pullRequest: pullRequest({ reviewDecision: 'changes_requested', mergeableState: 'BLOCKED' }),
			reviewFeedback: feedback([], [{ id: 'PRR_1', login: 'linter[bot]', bot: true }]),
		});
		expect(nextMergeQueueMove(botRequest)).toMatchObject({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":["PRR_1"],"threads":[]}',
		});
		const humanRequest = queued({
			pullRequest: pullRequest({ reviewDecision: 'changes_requested', mergeableState: 'BLOCKED' }),
			reviewFeedback: feedback(
				[thread('PRRT_human', false)],
				[{ id: 'PRR_2', login: 'alice', bot: false }],
			),
		});
		expect(nextMergeQueueMove(humanRequest)).toMatchObject({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":["PRR_2"],"threads":["PRRT_human"]}',
		});
	});

	it('addresses requested changes before merging, then merges when GitHub allows it', () => {
		const requested = {
			pullRequest: pullRequest({
				unresolvedReviewThreadCount: 1,
				reviewDecision: 'changes_requested',
			}),
			reviewFeedback: feedback(
				[thread('PRRT_human', false)],
				[{ id: 'PRR_2', login: 'alice', bot: false }],
			),
		};
		expect(nextMergeQueueMove(queued(requested))).toMatchObject({
			kind: 'run-job',
			builtin: 'address-review',
		});
		expect(nextMergeQueueMove(queued({ ...requested, addressedReviews: ['PRR_2'] }))).toEqual({
			kind: 'merge',
			method: 'squash',
			headSha: 'a'.repeat(40),
		});
	});

	it('waits for the reviewer once their changes are addressed, and asks you only to reply', () => {
		const addressed = {
			pullRequest: pullRequest({ reviewDecision: 'changes_requested', mergeableState: 'BLOCKED' }),
			addressedReviews: ['PRR_2'],
		};
		expect(
			nextMergeQueueMove(
				queued({
					...addressed,
					reviewFeedback: feedback([], [{ id: 'PRR_2', login: 'alice', bot: false }]),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-review' });
		expect(
			nextMergeQueueMove(
				queued({
					...addressed,
					reviewFeedback: feedback(
						[thread('PRRT_declined', false)],
						[{ id: 'PRR_2', login: 'alice', bot: false }],
					),
				}),
			),
		).toEqual({
			kind: 'needs-you',
			reason: 'reply-to-reviewer',
			detail: '@alice requested changes.',
			jobRunId: null,
		});
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({ mergeableState: 'BLOCKED', unresolvedReviewThreadCount: 1 }),
					reviewFeedback: feedback([thread('PRRT_human', false)]),
				}),
			),
		).toMatchObject({ reason: 'reply-to-reviewer' });
	});

	it('waits for a required approval: that is a reviewer turn, not the user', () => {
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({
						reviewDecision: 'review_required',
						mergeableState: 'BLOCKED',
					}),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-review' });
	});

	it('stops when the user may not merge or GitHub blocks for another reason', () => {
		expect(
			nextMergeQueueMove(queued({ pullRequest: pullRequest({ viewerCanMerge: false }) })),
		).toMatchObject({ kind: 'needs-you', reason: 'merge-not-permitted' });
		expect(
			nextMergeQueueMove(queued({ pullRequest: pullRequest({ allowedMergeMethods: [] }) })),
		).toMatchObject({ kind: 'needs-you', reason: 'merge-not-permitted' });
		expect(
			nextMergeQueueMove(queued({ pullRequest: pullRequest({ mergeableState: 'BLOCKED' }) })),
		).toEqual({
			kind: 'needs-you',
			reason: 'merge-not-permitted',
			detail: 'GitHub blocks this merge. Check the branch rules on GitHub.',
			jobRunId: null,
		});
	});

	it('waits while GitHub computes mergeability or the merge settings are unreadable', () => {
		expect(
			nextMergeQueueMove(
				queued({ pullRequest: pullRequest({ mergeable: null, mergeableState: 'UNKNOWN' }) }),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-github' });
		expect(
			nextMergeQueueMove(
				queued({ pullRequest: pullRequest({ viewerCanMerge: null, allowedMergeMethods: [] }) }),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-github' });
	});

	it('merges with the default method as soon as the pull request is ready', () => {
		expect(
			nextMergeQueueMove(queued({ pullRequest: pullRequest({ mergeableState: 'UNSTABLE' }) })),
		).toEqual({ kind: 'merge', method: 'squash', headSha: 'a'.repeat(40) });
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({ defaultMergeMethod: null, allowedMergeMethods: ['rebase'] }),
				}),
			),
		).toMatchObject({ kind: 'merge', method: 'rebase' });
	});

	it('does nothing while it needs the user', () => {
		expect(
			nextMergeQueueMove(
				queued({ phase: 'needs-you', worktree: { ...worktree, dirtyPaths: ['a.ts'] } }),
			),
		).toEqual({ kind: 'idle', problem: null });
	});
});

describe('merge queue helpers', () => {
	it('backs off from 30 seconds, doubling up to 10 minutes', () => {
		expect([1, 2, 3, 5, 6, 40].map((n) => shipBackoffMs(n, DEFAULT_SHIP_DELAYS))).toEqual([
			30_000, 60_000, 120_000, 480_000, 600_000, 600_000,
		]);
	});

	it('clamps the fix attempt setting to 1-20, defaulting when unset', () => {
		expect(['0', '5', '99', 'x', undefined].map((value) => clampedFixAttempts(value, 3))).toEqual([
			1, 5, 20, 3, 3,
		]);
	});

	it('reads review feedback only for an open pull request with threads or change requests', () => {
		expect(needsReviewFeedback(pullRequest())).toBe(false);
		expect(needsReviewFeedback(pullRequest({ unresolvedReviewThreadCount: 1 }))).toBe(true);
		expect(needsReviewFeedback(pullRequest({ reviewDecision: 'changes_requested' }))).toBe(true);
		expect(
			needsReviewFeedback(pullRequest({ state: 'merged', unresolvedReviewThreadCount: 1 })),
		).toBe(false);
	});

	it('gives the agent bot threads, open change requests and the threads of their reviewers', () => {
		const review = feedback(
			[thread('PRRT_human', false), thread('PRRT_bot', true), thread('PRRT_other', false, 'bob')],
			[
				{ id: 'PRR_h', login: 'alice', bot: false },
				{ id: 'PRR_b', login: 'linter[bot]', bot: true },
			],
		);
		const requested = pullRequest({ reviewDecision: 'changes_requested' });
		const forAgent = reviewFeedbackToAddress(review, reviewToAddress(review, requested, []));
		expect(forAgent.unresolvedThreads?.map((entry) => entry.id)).toEqual([
			'PRRT_bot',
			'PRRT_human',
		]);
		expect(forAgent.requestedChangeReviews?.map((entry) => entry.id)).toEqual(['PRR_h', 'PRR_b']);
		const handled = reviewToAddress(review, requested, ['PRR_h', 'PRR_b']);
		expect(handled.changeRequests).toEqual([]);
		expect(handled.threads.map((entry) => entry.id)).toEqual(['PRRT_bot']);
		expect(reviewToAddress(review, pullRequest(), []).changeRequests).toEqual([]);
	});

	it('reads back the change requests a review job addressed from its signature', () => {
		const review = reviewToAddress(
			feedback([thread('PRRT_bot', true)], [{ id: 'PRR_1', login: 'alice', bot: false }]),
			pullRequest({ reviewDecision: 'changes_requested' }),
			[],
		);
		expect(addressedChangeRequests(reviewSignature(review))).toEqual(['PRR_1']);
		expect(addressedChangeRequests('checks:["lint"]')).toEqual([]);
		expect(addressedChangeRequests('review:["PRRT_bot"]')).toEqual([]);
		expect(addressedChangeRequests(null)).toEqual([]);
	});
});

describe('what a read of the pull request reports', () => {
	it('names what GitHub shows, with the failing checks by name', () => {
		const read = pullRequest({
			draft: true,
			mergeable: false,
			behindBase: 2,
			checksState: 'failed',
			checks: [
				check('test', 'FAILURE'),
				check('lint', 'SUCCESS'),
				check('e2e', 'TIMED_OUT'),
				check('test', 'FAILURE'),
			],
			reviewDecision: 'changes_requested',
			unresolvedReviewThreadCount: 3,
		});

		expect(pullRequestChange('ws-1', read)).toEqual({
			workstreamId: 'ws-1',
			pullRequestNumber: 7,
			pullRequestUrl: 'https://github.com/acme/app/pull/7',
			state: 'draft',
			baseBranch: 'main',
			headSha: 'a'.repeat(40),
			checks: 'failed',
			failingChecks: ['e2e', 'test'],
			reviewDecision: 'changes_requested',
			unresolvedThreads: 3,
			behindBase: 2,
			conflicts: true,
		});
	});

	it('reports nothing without a pull request, or while GitHub has not seen the latest push', () => {
		expect(pullRequestChange('ws-1', pullRequest({ state: 'not_open', number: null }))).toBeNull();
		expect(pullRequestChange('ws-1', pullRequest({ includesLocalHead: false }))).toBeNull();
		expect(
			pullRequestChange('ws-1', pullRequest({ state: 'merged', includesLocalHead: false })),
		).toMatchObject({ state: 'merged', conflicts: false, failingChecks: [] });
	});
});
