import { describe, expect, it } from 'vitest';
import type {
	PullRequestCheckDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
	ReviewThreadDto,
} from '$contract/repositories';
import {
	DEFAULT_SHIP_DELAYS,
	botReviewFeedback,
	clampedFixAttempts,
	needsReviewFeedback,
	nextMergeQueueMove,
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

function thread(id: string, bot: boolean): ReviewThreadDto {
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
				authorLogin: bot ? 'coderabbitai[bot]' : 'alice',
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
		pullRequestNumber: 7,
		idle: true,
		job: null,
		lastJobRunId: 'job-last',
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
			problem: 'A rebase is in progress in this workstream. Finish or abort it, then push again.',
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
			detail: 'Fixing the checks did not work. malini tried 3 times.',
			jobRunId: 'job-last',
		});
		expect(
			nextMergeQueueMove(
				queued({ pullRequest: failing, failureSignature: same, attempts: 1, fixAttemptLimit: 1 }),
			),
		).toMatchObject({ reason: 'fix-gave-up', detail: expect.stringContaining('tried once') });
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

	it('hands bot review threads and bot change requests to the agent, never human ones', () => {
		const withThreads = queued({
			pullRequest: pullRequest({ unresolvedReviewThreadCount: 2 }),
			reviewFeedback: feedback([thread('PRRT_human', false), thread('PRRT_bot', true)]),
		});
		expect(nextMergeQueueMove(withThreads)).toEqual({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:["PRRT_bot"]',
			attempt: 1,
		});
		const botRequest = queued({
			pullRequest: pullRequest({ reviewDecision: 'changes_requested', mergeableState: 'BLOCKED' }),
			reviewFeedback: feedback([], [{ id: 'PRR_1', login: 'linter[bot]', bot: true }]),
		});
		expect(nextMergeQueueMove(botRequest)).toMatchObject({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:["PRR_1"]',
		});
	});

	it('merges past open human comments when GitHub allows it', () => {
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({
						unresolvedReviewThreadCount: 1,
						reviewDecision: 'changes_requested',
					}),
					reviewFeedback: feedback(
						[thread('PRRT_human', false)],
						[{ id: 'PRR_2', login: 'alice', bot: false }],
					),
				}),
			),
		).toEqual({ kind: 'merge', method: 'squash', headSha: 'a'.repeat(40) });
	});

	it('asks the user to reply when a human blocks the merge', () => {
		expect(
			nextMergeQueueMove(
				queued({
					pullRequest: pullRequest({
						reviewDecision: 'changes_requested',
						mergeableState: 'BLOCKED',
					}),
					reviewFeedback: feedback([], [{ id: 'PRR_2', login: 'alice', bot: false }]),
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

	it('keeps only bot feedback for the agent', () => {
		const onlyBots = botReviewFeedback(
			feedback(
				[thread('PRRT_human', false), thread('PRRT_bot', true)],
				[
					{ id: 'PRR_h', login: 'alice', bot: false },
					{ id: 'PRR_b', login: 'linter[bot]', bot: true },
				],
			),
		);
		expect(onlyBots.unresolvedThreads?.map((entry) => entry.id)).toEqual(['PRRT_bot']);
		expect(onlyBots.requestedChangeReviews?.map((entry) => entry.id)).toEqual(['PRR_b']);
	});
});
