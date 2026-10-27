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
	nextShippingMove,
	pullRequestChange,
	pullRequestFacts,
	pullRequestReadEvery,
	reviewFeedbackToAddress,
	reviewSignature,
	reviewToAddress,
	shipBackoffMs,
	type PullRequestFacts,
	type ShippingSnapshot,
} from './shipping';

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

type Fixture = Omit<Partial<ShippingSnapshot>, 'pullRequest'> &
	Readonly<{
		pullRequest?: PullRequestStatusDto | null;
		reviewFeedback?: ReviewFeedbackDto | null;
	}>;

function facts(
	read: PullRequestStatusDto,
	review: ReviewFeedbackDto | null = null,
): PullRequestFacts {
	const change = pullRequestChange('ws-1', read, review);
	if (change === null) throw new Error('expected a pull request GitHub reports');
	return change;
}

function queued(overrides: Fixture = {}): ShippingSnapshot {
	const { pullRequest: read = pullRequest(), reviewFeedback = null, ...rest } = overrides;
	return {
		phase: 'queued',
		pushRequested: false,
		reviewRequested: false,
		addressedReviews: [],
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
		read: read !== null,
		pullRequest: read === null ? null : pullRequestChange('ws-1', read, reviewFeedback),
		...rest,
	};
}

const worktree = queued().worktree;

describe('a draft workstream', () => {
	const draft = (overrides: Fixture = {}): ShippingSnapshot =>
		queued({ phase: 'draft', pushRequested: true, pullRequest: null, ...overrides });

	it('does nothing until an agent run or the user asks for a push', () => {
		expect(nextShippingMove(draft({ pushRequested: false }))).toEqual({
			kind: 'idle',
			problem: null,
		});
	});

	it('waits for the agent, then opens the draft pull request when none exists', () => {
		expect(nextShippingMove(draft({ idle: false, pullRequestNumber: null }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(nextShippingMove(draft({ pullRequestNumber: null }))).toEqual({
			kind: 'open-draft',
		});
	});

	it('pushes unpushed work to an existing pull request, and settles when there is none', () => {
		expect(nextShippingMove(draft({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } }))).toEqual({
			kind: 'push',
		});
		expect(nextShippingMove(draft({ worktree: { ...worktree, ahead: 2 } }))).toEqual({
			kind: 'push',
		});
		expect(nextShippingMove(draft())).toEqual({ kind: 'idle', problem: null });
	});

	it('never fixes anything: a failing pull request in a draft only gets pushes', () => {
		expect(
			nextShippingMove(draft({ pullRequest: pullRequest({ checks: [check('test', 'FAILURE')] }) })),
		).toEqual({ kind: 'idle', problem: null });
	});

	it('never updates from main: a draft behind or conflicting with main only gets pushes', () => {
		for (const behind of [
			pullRequest({ mergeableState: 'BEHIND', behindBase: 4 }),
			pullRequest({ mergeable: false, mergeableState: 'DIRTY', behindBase: 4 }),
		]) {
			expect(nextShippingMove(draft({ pullRequest: behind }))).toEqual({
				kind: 'idle',
				problem: null,
			});
			expect(
				nextShippingMove(draft({ pullRequest: behind, worktree: { ...worktree, ahead: 1 } })),
			).toEqual({ kind: 'push' });
		}
	});

	it('refuses to push in the middle of a rebase and says why', () => {
		expect(
			nextShippingMove(draft({ worktree: { ...worktree, operationInProgress: 'rebase' } })),
		).toEqual({
			kind: 'idle',
			problem: 'A rebase is in progress in this workstream. Finish or abort it, then try again.',
		});
	});
});

describe('a local or draft workstream before you merge', () => {
	const local = (overrides: Fixture = {}): ShippingSnapshot =>
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
			nextShippingMove(
				local({ pushRequested: true, worktree: { ...worktree, dirtyPaths: ['a.ts'] } }),
			),
		).toEqual({ kind: 'commit' });
		expect(
			nextShippingMove(local({ pushRequested: true, worktree: { ...worktree, ahead: 3 } })),
		).toEqual({ kind: 'idle', problem: null });
	});

	it('addresses a change request on its own while you work, once per review', () => {
		const requested = (overrides: Fixture = {}) =>
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
		expect(nextShippingMove(requested())).toEqual({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":["PRR_2"],"threads":["PRRT_human"]}',
			attempt: 1,
		});
		expect(nextShippingMove(requested({ addressedReviews: ['PRR_2'] }))).toEqual({
			kind: 'idle',
			problem: null,
		});
		expect(nextShippingMove(requested({ pullRequest: null }))).toEqual({
			kind: 'read-pull-request',
		});
		expect(
			nextShippingMove(requested({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } })),
		).toEqual({ kind: 'idle', problem: null });
		expect(nextShippingMove(requested({ idle: false }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(
			nextShippingMove(
				requested({ threadResolutionRunId: 'run-fix', addressedReviews: ['PRR_2'] }),
			),
		).toEqual({ kind: 'resolve-threads', agentRunId: 'run-fix' });
	});

	it('shows the update and conflict jobs while they run', () => {
		expect(
			nextShippingMove(local({ job: { builtin: 'update-from-main', status: 'running' } })),
		).toEqual({ kind: 'wait', step: 'updating-from-main' });
		expect(
			nextShippingMove(local({ job: { builtin: 'resolve-conflicts', status: 'queued' } })),
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
		expect(nextShippingMove(local({ ...afterUpdate, worktree: conflicted }))).toEqual(resolve);
		expect(nextShippingMove(local({ ...afterUpdate, worktree: unstaged }))).toEqual(resolve);
		expect(nextShippingMove(local({ ...afterResolve, worktree: unstaged }))).toEqual({
			kind: 'commit',
		});
		expect(
			nextShippingMove(queued({ phase: 'draft', ...afterResolve, worktree: unstaged })),
		).toEqual({ kind: 'push' });
		expect(
			nextShippingMove(
				local({ ...afterResolve, failureSignature: 'update', attempts: 1, worktree: conflicted }),
			),
		).toEqual(resolve);
		expect(
			nextShippingMove(
				local({
					...afterResolve,
					failureSignature: 'conflicts:["a.ts"]',
					attempts: 1,
					worktree: conflicted,
				}),
			),
		).toEqual({ ...resolve, attempt: 2 });
		expect(
			nextShippingMove(
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
			nextShippingMove(
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
		expect(nextShippingMove(queued({ backoffUntil: 5_000 }))).toEqual({ kind: 'backoff' });
		expect(nextShippingMove(queued({ backoffUntil: 500 }))).toMatchObject({ kind: 'merge' });
	});

	it('waits while the agent or its own job is busy, showing the job step', () => {
		expect(nextShippingMove(queued({ idle: false }))).toEqual({
			kind: 'wait',
			step: 'waiting-for-agent',
		});
		expect(nextShippingMove(queued({ job: { builtin: 'fix-checks', status: 'running' } }))).toEqual(
			{ kind: 'wait', step: 'fixing-checks' },
		);
		expect(
			nextShippingMove(queued({ job: { builtin: 'address-review', status: 'needs-you' } })),
		).toEqual({ kind: 'wait', step: 'addressing-review' });
	});

	it('asks the user to finish a rebase or cherry-pick they started', () => {
		expect(
			nextShippingMove(queued({ worktree: { ...worktree, operationInProgress: 'cherry-pick' } })),
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
			nextShippingMove(queued({ worktree: { ...merging, conflictedPaths: ['b.ts', 'a.ts'] } })),
		).toEqual({
			kind: 'run-job',
			builtin: 'resolve-conflicts',
			signature: 'conflicts:["a.ts","b.ts"]',
			attempt: 1,
		});
		expect(nextShippingMove(queued({ worktree: merging }))).toEqual({ kind: 'push' });
	});

	it('commits conflicts a resolve-conflicts job cleared of markers, even when it left them unstaged', () => {
		const unstaged = {
			...worktree,
			operationInProgress: 'merge' as const,
			conflictedPaths: ['a.ts'],
		};
		expect(
			nextShippingMove(queued({ settledJob: 'resolve-conflicts', worktree: unstaged })),
		).toEqual({ kind: 'push' });
		expect(
			nextShippingMove(queued({ settledJob: 'update-from-main', worktree: unstaged })),
		).toMatchObject({ kind: 'run-job', builtin: 'resolve-conflicts' });
		expect(
			nextShippingMove(
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
		expect(nextShippingMove(queued({ pullRequestNumber: null }))).toEqual({
			kind: 'open-draft',
		});
		expect(nextShippingMove(queued({ worktree: { ...worktree, dirtyPaths: ['a.ts'] } }))).toEqual({
			kind: 'push',
		});
		expect(nextShippingMove(queued({ worktree: { ...worktree, hasUpstream: false } }))).toEqual({
			kind: 'push',
		});
	});

	it('resolves the threads an address-review job fixed once its work is pushed', () => {
		expect(nextShippingMove(queued({ threadResolutionRunId: 'run-9' }))).toEqual({
			kind: 'resolve-threads',
			agentRunId: 'run-9',
		});
	});

	it('reads the pull request only once everything local is settled', () => {
		expect(nextShippingMove(queued({ pullRequest: null }))).toEqual({
			kind: 'read-pull-request',
		});
	});

	it('lands a pull request merged anywhere, and stops at one closed without merging', () => {
		expect(nextShippingMove(queued({ pullRequest: pullRequest({ state: 'merged' }) }))).toEqual({
			kind: 'land',
		});
		expect(nextShippingMove(queued({ pullRequest: pullRequest({ state: 'closed' }) }))).toEqual({
			kind: 'needs-you',
			reason: 'pull-request-closed',
			detail: 'Pull request #7 was closed without merging.',
			jobRunId: null,
		});
		expect(nextShippingMove(queued({ pullRequest: pullRequest({ state: 'not_open' }) }))).toEqual({
			kind: 'open-draft',
		});
	});

	it('marks a draft ready before anything else on GitHub', () => {
		expect(
			nextShippingMove(
				queued({
					pullRequest: pullRequest({ draft: true, checks: [check('test', 'FAILURE')] }),
				}),
			),
		).toEqual({ kind: 'mark-ready' });
	});

	it('updates a conflicting or behind branch', () => {
		const conflicting = pullRequest({ mergeable: false, mergeableState: 'DIRTY' });
		const behind = pullRequest({ mergeableState: 'BEHIND' });
		expect(nextShippingMove(queued({ pullRequest: conflicting }))).toEqual({
			kind: 'update-branch',
		});
		expect(nextShippingMove(queued({ pullRequest: behind }))).toEqual({
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
		expect(nextShippingMove(queued({ pullRequest: failing }))).toEqual({
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
			nextShippingMove(queued({ pullRequest: failing, failureSignature: same, attempts: 2 })),
		).toMatchObject({ kind: 'run-job', attempt: 3 });
		expect(
			nextShippingMove(
				queued({ pullRequest: failing, failureSignature: 'checks:["test"]', attempts: 3 }),
			),
		).toMatchObject({ kind: 'run-job', attempt: 1 });
		expect(
			nextShippingMove(queued({ pullRequest: failing, failureSignature: same, attempts: 3 })),
		).toEqual({
			kind: 'needs-you',
			reason: 'fix-gave-up',
			detail: 'Fixing the checks did not work. Malini tried 3 times.',
			jobRunId: 'job-last',
		});
		expect(
			nextShippingMove(
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
		const after = (checks: PullRequestCheckDto[], now: number): ShippingSnapshot =>
			queued({
				pullRequest: pullRequest({ checksState: 'failed', checks }),
				failureSignature: 'checks:["conventional"]',
				fixSucceededAt: fixedAt,
				attempts: 1,
				now,
			});

		expect(nextShippingMove(after([ranAt('2026-10-12T11:04:00Z')], fixedAt + 1_000))).toEqual({
			kind: 'wait',
			step: 'waiting-for-checks',
			until: fixedAt + 60_000,
		});
		expect(nextShippingMove(after([ranAt('2026-10-12T11:04:00Z')], fixedAt + 60_000))).toEqual({
			kind: 'needs-you',
			reason: 'fix-gave-up',
			detail: 'The failing checks did not run again after the last fix.',
			jobRunId: 'job-last',
		});
		expect(
			nextShippingMove(after([ranAt('2026-10-12T11:06:00Z')], fixedAt + 60_000)),
		).toMatchObject({ kind: 'run-job', attempt: 2 });
		expect(nextShippingMove(after([check('conventional', 'FAILURE')], fixedAt))).toMatchObject({
			kind: 'run-job',
			attempt: 2,
		});
	});

	it('waits for running checks', () => {
		expect(
			nextShippingMove(
				queued({
					pullRequest: pullRequest({
						checksState: 'pending',
						checks: [check('test', null, 'IN_PROGRESS')],
					}),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-checks' });
		expect(
			nextShippingMove(
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
		expect(nextShippingMove(withThreads)).toEqual({
			kind: 'run-job',
			builtin: 'address-review',
			signature: 'review:{"changeRequests":[],"threads":["PRRT_bot"]}',
			attempt: 1,
		});
		const botRequest = queued({
			pullRequest: pullRequest({ reviewDecision: 'changes_requested', mergeableState: 'BLOCKED' }),
			reviewFeedback: feedback([], [{ id: 'PRR_1', login: 'linter[bot]', bot: true }]),
		});
		expect(nextShippingMove(botRequest)).toMatchObject({
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
		expect(nextShippingMove(humanRequest)).toMatchObject({
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
		expect(nextShippingMove(queued(requested))).toMatchObject({
			kind: 'run-job',
			builtin: 'address-review',
		});
		expect(nextShippingMove(queued({ ...requested, addressedReviews: ['PRR_2'] }))).toEqual({
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
			nextShippingMove(
				queued({
					...addressed,
					reviewFeedback: feedback([], [{ id: 'PRR_2', login: 'alice', bot: false }]),
				}),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-review' });
		expect(
			nextShippingMove(
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
			nextShippingMove(
				queued({
					pullRequest: pullRequest({ mergeableState: 'BLOCKED', unresolvedReviewThreadCount: 1 }),
					reviewFeedback: feedback([thread('PRRT_human', false)]),
				}),
			),
		).toMatchObject({ reason: 'reply-to-reviewer' });
	});

	it('waits for a required approval: that is a reviewer turn, not the user', () => {
		expect(
			nextShippingMove(
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
			nextShippingMove(queued({ pullRequest: pullRequest({ viewerCanMerge: false }) })),
		).toMatchObject({ kind: 'needs-you', reason: 'merge-not-permitted' });
		expect(
			nextShippingMove(queued({ pullRequest: pullRequest({ allowedMergeMethods: [] }) })),
		).toMatchObject({ kind: 'needs-you', reason: 'merge-not-permitted' });
		expect(
			nextShippingMove(queued({ pullRequest: pullRequest({ mergeableState: 'BLOCKED' }) })),
		).toEqual({
			kind: 'needs-you',
			reason: 'merge-not-permitted',
			detail: 'GitHub blocks this merge. Check the branch rules on GitHub.',
			jobRunId: null,
		});
	});

	it('waits while GitHub computes mergeability or the merge settings are unreadable', () => {
		expect(
			nextShippingMove(
				queued({ pullRequest: pullRequest({ mergeable: null, mergeableState: 'UNKNOWN' }) }),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-github' });
		expect(
			nextShippingMove(
				queued({ pullRequest: pullRequest({ viewerCanMerge: null, allowedMergeMethods: [] }) }),
			),
		).toEqual({ kind: 'wait', step: 'waiting-for-github' });
	});

	it('merges with the default method as soon as the pull request is ready', () => {
		expect(
			nextShippingMove(queued({ pullRequest: pullRequest({ mergeableState: 'UNSTABLE' }) })),
		).toEqual({ kind: 'merge', method: 'squash', headSha: 'a'.repeat(40) });
		expect(
			nextShippingMove(
				queued({
					pullRequest: pullRequest({ defaultMergeMethod: null, allowedMergeMethods: ['rebase'] }),
				}),
			),
		).toMatchObject({ kind: 'merge', method: 'rebase' });
	});

	it('does nothing while it needs the user', () => {
		expect(
			nextShippingMove(
				queued({ phase: 'needs-you', worktree: { ...worktree, dirtyPaths: ['a.ts'] } }),
			),
		).toEqual({ kind: 'idle', problem: null });
	});
});

describe('shipping helpers', () => {
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
		const requested = facts(pullRequest({ reviewDecision: 'changes_requested' }), review);
		const forAgent = reviewFeedbackToAddress(review, reviewToAddress(requested, []));
		expect(forAgent.unresolvedThreads?.map((entry) => entry.id).sort()).toEqual([
			'PRRT_bot',
			'PRRT_human',
		]);
		expect(forAgent.requestedChangeReviews?.map((entry) => entry.id)).toEqual(['PRR_h', 'PRR_b']);
		const handled = reviewToAddress(requested, ['PRR_h', 'PRR_b']);
		expect(handled.changeRequests).toEqual([]);
		expect(handled.threads.map((entry) => entry.id)).toEqual(['PRRT_bot']);
		expect(reviewToAddress(facts(pullRequest(), review), []).changeRequests).toEqual([]);
	});

	it('reads back the change requests a review job addressed from its signature', () => {
		const review = reviewToAddress(
			facts(
				pullRequest({ reviewDecision: 'changes_requested' }),
				feedback([thread('PRRT_bot', true)], [{ id: 'PRR_1', login: 'alice', bot: false }]),
			),
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

		const failed = (name: string, state: string) => ({
			name,
			state,
			required: null,
			appId: null,
			completedAt: null,
		});
		expect(pullRequestChange('ws-1', read, null)).toEqual({
			workstreamId: 'ws-1',
			pullRequestNumber: 7,
			pullRequestUrl: 'https://github.com/acme/app/pull/7',
			state: 'draft',
			baseBranch: 'main',
			headSha: 'a'.repeat(40),
			checks: 'failed',
			checksPending: false,
			failingChecks: ['e2e', 'test'],
			blockingChecks: [failed('e2e', 'TIMED_OUT'), failed('test', 'FAILURE')],
			reviewDecision: 'changes_requested',
			unresolvedThreads: 3,
			changeRequests: null,
			threads: null,
			behindBase: 2,
			conflicts: true,
			mergeability: 'conflicts',
			viewerCanMerge: true,
			mergeMethod: 'squash',
		});
	});

	it('tells a new review from the last one even when its counts match', () => {
		const read = pullRequest({
			reviewDecision: 'changes_requested',
			unresolvedReviewThreadCount: 1,
		});
		const first = pullRequestChange(
			'ws-1',
			read,
			feedback([thread('PRRT_1', false)], [{ id: 'PRR_1', login: 'alice', bot: false }]),
		);
		const second = pullRequestChange(
			'ws-1',
			read,
			feedback([thread('PRRT_1', false)], [{ id: 'PRR_2', login: 'alice', bot: false }]),
		);
		expect(first).toMatchObject({ unresolvedThreads: 1, reviewDecision: 'changes_requested' });
		expect(second).toMatchObject({ unresolvedThreads: 1, reviewDecision: 'changes_requested' });
		expect(first?.changeRequests).toEqual([{ id: 'PRR_1', by: 'alice', bot: false }]);
		expect(second?.changeRequests).toEqual([{ id: 'PRR_2', by: 'alice', bot: false }]);
		expect(second).not.toEqual(first);
	});

	it('tells a check that ran again from the run before it', () => {
		const ran = (completedAt: string) =>
			pullRequestChange(
				'ws-1',
				pullRequest({
					checksState: 'failed',
					checks: [{ ...check('test', 'FAILURE'), completedAt }],
				}),
				null,
			);
		expect(ran('2026-10-12T11:04:00Z')).not.toEqual(ran('2026-10-12T11:06:00Z'));
	});

	it('reads back the facts it logged, and nothing from an older payload', () => {
		const logged = pullRequestChange(
			'ws-1',
			pullRequest({ reviewDecision: 'changes_requested' }),
			feedback([], [{ id: 'PRR_1', login: 'alice', bot: false }]),
		);
		expect(pullRequestFacts(JSON.parse(JSON.stringify(logged)))).toEqual(logged);
		expect(
			pullRequestFacts({
				workstreamId: 'ws-1',
				pullRequestNumber: 7,
				state: 'open',
				checks: 'success',
				failingChecks: [],
				conflicts: false,
			}),
		).toBeNull();
		expect(pullRequestFacts(null)).toBeNull();
	});

	it('reports nothing without a pull request, or while GitHub has not seen the latest push', () => {
		expect(
			pullRequestChange('ws-1', pullRequest({ state: 'not_open', number: null }), null),
		).toBeNull();
		expect(pullRequestChange('ws-1', pullRequest({ includesLocalHead: false }), null)).toBeNull();
		expect(
			pullRequestChange('ws-1', pullRequest({ state: 'merged', includesLocalHead: false }), null),
		).toMatchObject({ state: 'merged', conflicts: false, failingChecks: [] });
	});
});

describe('when Malini reads GitHub on its own', () => {
	const ship = (
		phase: 'local' | 'draft' | 'queued' | 'needs-you',
		step: Parameters<typeof pullRequestReadEvery>[0]['step'] = null,
		activeJobRunId: string | null = null,
	) => pullRequestReadEvery({ phase, step, activeJobRunId }, DEFAULT_SHIP_DELAYS);

	it('reads only while shipping waits on GitHub, as often as the wait needs', () => {
		expect(ship('local')).toBeNull();
		expect(ship('draft')).toBeNull();
		expect(ship('draft', 'waiting-for-github')).toBe(15_000);
		expect(ship('queued')).toBe(15_000);
		expect(ship('queued', 'waiting-for-checks')).toBe(45_000);
		expect(ship('queued', 'waiting-for-review')).toBe(120_000);
		expect(ship('needs-you')).toBe(120_000);
	});

	it('never reads while an agent or a job works: their own events say when they finish', () => {
		expect(ship('queued', 'waiting-for-agent')).toBeNull();
		expect(ship('queued', 'fixing-checks')).toBeNull();
		expect(ship('queued', null, 'job-1')).toBeNull();
	});
});
