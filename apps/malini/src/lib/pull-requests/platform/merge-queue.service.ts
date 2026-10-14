import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import {
	JOB_INTERRUPTED_DETAIL,
	type JobBuiltin,
	type JobDefinitionRecord,
	type JobRunRecord,
} from '$contract/jobs';
import {
	DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	type ShipPhase,
	type ShipStateRecord,
	type ShipStep,
} from '$contract/pull-requests';
import type { ReviewFeedbackDto, Workstream, WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { describeError, isGhError, isGitError } from '$main/errors';
import { getRunWorkstreamId, workstreamShipContext } from '$lib/chat/chat.platform';
import {
	automatedPullRequestMetadata,
	getWorkstream,
	githubFullNameFromRemote,
	resolveConnectedRepository,
	type AutomatedPullRequestMetadata,
	type ConnectedRepository,
	type PullRequestAutomationContext,
} from '$shared/repositories/repositories.platform';
import {
	DEFAULT_SHIP_DELAYS,
	blockingFailedChecks,
	botReviewFeedback,
	clampedFixAttempts,
	jobIsActive,
	jobStep,
	needsReviewFeedback,
	nextMergeQueueMove,
	shipBackoffMs,
	type MergeQueueMove,
	type MergeQueueSnapshot,
	type ShipDelays,
} from '../domain/merge-queue';
import { checkFixJobContext, reviewFixJobContext } from '../domain/pull-request-fix-prompt';
import {
	deleteShip,
	getShip,
	insertShip,
	listShips,
	shipRecord,
	updateShip,
	type ShipPatch,
	type ShipRow,
} from './ship.repository';

type Operation<Name extends CommandName> = (
	args: CommandArgs<Name>,
) => Promise<CommandResult<Name>>;

export type PullRequestOperations = Readonly<{
	status: Operation<'pull-requests.status'>;
	create: Operation<'pull-requests.create'>;
	markReady: Operation<'pull-requests.mark-ready'>;
	merge: Operation<'pull-requests.merge'>;
	updateMetadata: Operation<'pull-requests.update-metadata'>;
	checkDiagnostics: Operation<'pull-requests.check-diagnostics'>;
	reviewFeedback: Operation<'pull-requests.review-feedback'>;
	resolveAddressedReviewThreads: Operation<'pull-requests.resolve-addressed-review-threads'>;
}>;

export interface MergeQueueOptions {
	delays?: Partial<ShipDelays>;
	now?: () => number;
}

export type ShipErrorKind = 'nothing-to-ship' | 'not-github' | 'unknown-workstream' | 'not-queued';

export class ShipError extends Error {
	readonly kind: ShipErrorKind;

	constructor(kind: ShipErrorKind, message: string) {
		super(message);
		this.name = 'ShipError';
		this.kind = kind;
	}
}

type ShipTarget = Readonly<{
	workstream: Workstream;
	repository: ConnectedRepository;
	repoId: string;
	base: string;
}>;

type SettledJob = Readonly<{ builtin: JobBuiltin | null; agentRunId: string | null }>;

type Idleness = Readonly<{ idle: boolean; settlesInMs: number | null }>;

type MoveContext = Readonly<{
	row: ShipRow;
	target: ShipTarget;
	worktree: WorktreeStatus;
	snapshot: MergeQueueSnapshot;
	idleness: Idleness;
	pushGeneration: number | null;
	updateGeneration: number | null;
}>;

const MAX_MOVES_PER_WAKE = 10;

const EMPTY_REVIEW_FEEDBACK: ReviewFeedbackDto = {
	unresolvedThreads: [],
	unresolvedThreadsComplete: true,
	requestedChangeReviews: [],
	requestedChangeReviewsComplete: true,
	truncated: false,
};

export class MergeQueue {
	readonly #context: MainContext;
	readonly #ops: PullRequestOperations;
	readonly #delays: ShipDelays;
	readonly #now: () => number;
	readonly #running = new Map<string, Promise<void>>();
	readonly #again = new Set<string>();
	readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #pushRequests = new Map<string, number>();
	readonly #updateRequests = new Map<string, number>();
	readonly #updateRequestedAt = new Map<string, number>();
	readonly #runEndedAt = new Map<string, number>();
	readonly #settled = new Map<string, SettledJob>();
	readonly #failures = new Map<string, number>();
	readonly #jobs = new Map<string, JobRunRecord>();
	readonly #builtins = new Map<string, JobBuiltin>();
	#disposed = false;

	constructor(
		context: MainContext,
		operations: PullRequestOperations,
		options: MergeQueueOptions = {},
	) {
		this.#context = context;
		this.#ops = operations;
		this.#delays = { ...DEFAULT_SHIP_DELAYS, ...options.delays };
		this.#now = options.now ?? Date.now;
	}

	start(): void {
		void this.#resume();
	}

	dispose(): void {
		this.#disposed = true;
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
	}

	states(): ShipStateRecord[] {
		return listShips(this.#context.db).map(shipRecord);
	}

	async openDraft(workstreamId: string): Promise<ShipStateRecord> {
		const target = await this.#target(workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (row && row.phase !== 'draft' && row.phase !== 'local') return shipRecord(row);
		if (row?.pullRequestNumber == null) await this.#refuseNothingToShip(target);
		this.#failures.delete(workstreamId);
		this.#requestPush(workstreamId);
		const saved = this.#upsert(workstreamId, 'draft', {
			phase: 'draft',
			step: row?.pullRequestNumber == null ? 'opening-draft' : 'pushing',
			lastError: null,
			nextAttemptAt: null,
		});
		this.wake(workstreamId);
		return saved;
	}

	async queueMerge(workstreamId: string): Promise<ShipStateRecord> {
		const target = await this.#target(workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (row?.phase === 'queued') return shipRecord(row);
		if (row?.pullRequestNumber == null) await this.#refuseNothingToShip(target);
		this.#failures.delete(workstreamId);
		const saved = this.#upsert(workstreamId, 'queued', {
			phase: 'queued',
			step: null,
			queuedAt: new Date(this.#now()).toISOString(),
			attempts: 0,
			failureSignature: null,
			needsYou: null,
			lastError: null,
			nextAttemptAt: null,
		});
		this.wake(workstreamId);
		return saved;
	}

	async cancelMerge(workstreamId: string): Promise<ShipStateRecord | null> {
		const row = getShip(this.#context.db, workstreamId);
		if (!row) return null;
		if (row.phase === 'draft' || row.phase === 'local') return shipRecord(row);
		const saved = this.#save(workstreamId, {
			phase: row.pullRequestNumber === null ? 'local' : 'draft',
			step: null,
			needsYou: null,
			queuedAt: null,
			attempts: 0,
			failureSignature: null,
			activeJobRunId: null,
			lastError: null,
			nextAttemptAt: null,
		});
		this.#clearTimer(workstreamId);
		this.#pushRequests.delete(workstreamId);
		this.#settled.delete(workstreamId);
		this.#failures.delete(workstreamId);
		if (row.activeJobRunId) {
			await this.#context.commands
				.call('jobs.cancel-run', { jobRunId: row.activeJobRunId })
				.catch(() => undefined);
		}
		return saved ? shipRecord(saved) : null;
	}

	async retryMerge(workstreamId: string): Promise<ShipStateRecord> {
		const row = getShip(this.#context.db, workstreamId);
		if (!row) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
		if (row.phase !== 'needs-you') return shipRecord(row);
		this.#failures.delete(workstreamId);
		const saved = this.#save(workstreamId, {
			phase: 'queued',
			step: null,
			needsYou: null,
			queuedAt: row.queuedAt ?? new Date(this.#now()).toISOString(),
			attempts: 0,
			failureSignature: null,
			lastError: null,
			nextAttemptAt: null,
		});
		if (!saved) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
		this.wake(workstreamId);
		return shipRecord(saved);
	}

	async agentRunEnded(runId: string): Promise<void> {
		const workstreamId = getRunWorkstreamId(this.#context.db, runId);
		if (workstreamId === null) return;
		const row = await this.#tracked(workstreamId);
		if (!row) return;
		this.#runEndedAt.set(workstreamId, this.#now());
		if (row.phase === 'local' || row.phase === 'draft') this.#requestPush(workstreamId);
		this.wake(workstreamId);
	}

	async workstreamOpened(workstreamId: string): Promise<void> {
		const last = this.#updateRequestedAt.get(workstreamId);
		if (last !== undefined && this.#now() - last < this.#delays.baseCheckMs) return;
		const row = await this.#tracked(workstreamId);
		if (!row || (row.phase !== 'local' && row.phase !== 'draft')) return;
		this.#updateRequestedAt.set(workstreamId, this.#now());
		this.#updateRequests.set(workstreamId, (this.#updateRequests.get(workstreamId) ?? 0) + 1);
		this.wake(workstreamId);
	}

	jobChanged(run: JobRunRecord): void {
		this.#jobs.set(run.id, run);
		if (run.workstreamId === null) return;
		if (getShip(this.#context.db, run.workstreamId)?.activeJobRunId === run.id) {
			this.wake(run.workstreamId);
		}
	}

	workstreamRemoved(workstreamId: string): void {
		deleteShip(this.#context.db, workstreamId);
		this.#forget(workstreamId);
	}

	wake(workstreamId: string): void {
		if (this.#disposed) return;
		this.#clearTimer(workstreamId);
		if (this.#running.has(workstreamId)) {
			this.#again.add(workstreamId);
			return;
		}
		const drain = this.#drain(workstreamId).finally(() => this.#running.delete(workstreamId));
		this.#running.set(workstreamId, drain);
	}

	async #resume(): Promise<void> {
		await this.#loadJobs();
		for (const row of listShips(this.#context.db)) {
			if (row.phase === 'draft' && row.step !== null) this.#requestPush(row.workstreamId);
			if (
				row.phase === 'queued' ||
				row.activeJobRunId !== null ||
				this.#pushRequests.has(row.workstreamId)
			) {
				this.wake(row.workstreamId);
			}
		}
	}

	async #loadJobs(): Promise<void> {
		const { commands } = this.#context;
		const [runs, definitions] = await Promise.all([
			commands.call('jobs.list-runs', undefined).catch(() => []),
			commands.call('jobs.list-definitions', undefined).catch(() => []),
		]);
		for (const run of runs) if (!this.#jobs.has(run.id)) this.#jobs.set(run.id, run);
		this.#rememberBuiltins(definitions);
	}

	async #drain(workstreamId: string): Promise<void> {
		do {
			this.#again.delete(workstreamId);
			await this.#advance(workstreamId);
		} while (this.#again.has(workstreamId) && !this.#disposed);
	}

	async #advance(workstreamId: string): Promise<void> {
		for (let moves = 0; moves < MAX_MOVES_PER_WAKE; moves += 1) {
			if (this.#disposed) return;
			let progressed: boolean;
			try {
				progressed = await this.#step(workstreamId);
			} catch (error) {
				progressed = false;
				this.#failed(workstreamId, error);
			}
			if (!progressed) return;
		}
		this.#schedule(workstreamId, this.#delays.githubPollMs);
	}

	async #step(workstreamId: string): Promise<boolean> {
		const { db, commands } = this.#context;
		const found = getShip(db, workstreamId);
		if (!found) return false;
		if (!getWorkstream(db, workstreamId)) {
			this.workstreamRemoved(workstreamId);
			return false;
		}
		const row = await this.#reconcileJob(found);
		if (row.phase === 'needs-you') return false;
		const pushGeneration = this.#pushRequests.get(workstreamId) ?? null;
		const updateGeneration = this.#updateRequests.get(workstreamId) ?? null;
		const working = row.phase === 'local' || row.phase === 'draft';
		if (
			working &&
			pushGeneration === null &&
			updateGeneration === null &&
			row.activeJobRunId === null
		) {
			this.#save(workstreamId, { step: null });
			return false;
		}
		const target = await this.#target(workstreamId);
		const idleness = await this.#idleness(workstreamId);
		const worktree = await commands.call('repositories.workstream-status', { workstreamId });
		const settled = this.#settledFor(workstreamId, worktree);
		const job = this.#activeJob(row);
		const lastJob = this.#lastJob(workstreamId);
		let snapshot: MergeQueueSnapshot = {
			phase: row.phase,
			pushRequested: pushGeneration !== null,
			updateRequested: updateGeneration !== null,
			behindBase: null,
			pullRequestNumber: row.pullRequestNumber,
			idle: idleness.idle,
			job: job
				? { builtin: this.#builtins.get(job.definitionId) ?? null, status: job.status }
				: null,
			lastJobRunId: lastJob?.id ?? null,
			lastJobBuiltin: lastJob ? (this.#builtins.get(lastJob.definitionId) ?? null) : null,
			settledJob: settled?.builtin ?? null,
			worktree,
			threadResolutionRunId: settled?.builtin === 'address-review' ? settled.agentRunId : null,
			failureSignature: row.failureSignature,
			fixSucceededAt:
				lastJob?.status === 'succeeded' && lastJob.finishedAt !== null
					? Date.parse(lastJob.finishedAt)
					: null,
			attempts: row.attempts,
			fixAttemptLimit:
				row.phase === 'queued' ? await this.#fixAttemptLimit() : DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
			backoffUntil: row.nextAttemptAt === null ? null : Date.parse(row.nextAttemptAt),
			now: this.#now(),
			pullRequest: null,
			reviewFeedback: null,
		};
		let move = nextMergeQueueMove(snapshot);
		if (move.kind === 'read-pull-request') {
			snapshot = await this.#withPullRequest(snapshot, target, row);
			move = nextMergeQueueMove(snapshot);
		}
		if (move.kind === 'read-base') {
			const behindBase = await commands.call('repositories.count-behind-base', {
				workstreamId,
				baseBranch: target.base,
			});
			snapshot = { ...snapshot, behindBase };
			move = nextMergeQueueMove(snapshot);
		}
		return this.#apply(
			{ row, target, worktree, snapshot, idleness, pushGeneration, updateGeneration },
			move,
		);
	}

	async #withPullRequest(
		snapshot: MergeQueueSnapshot,
		target: ShipTarget,
		row: ShipRow,
	): Promise<MergeQueueSnapshot> {
		const pullRequest = await this.#ops.status({
			repoId: target.repoId,
			workstreamId: row.workstreamId,
			head: target.workstream.branch,
			base: target.base,
			pullRequestNumber: row.pullRequestNumber,
		});
		const reviewFeedback =
			needsReviewFeedback(pullRequest) && pullRequest.number !== null
				? await this.#ops.reviewFeedback({
						repoId: target.repoId,
						workstreamId: row.workstreamId,
						pullRequestNumber: pullRequest.number,
					})
				: null;
		return { ...snapshot, pullRequest, reviewFeedback };
	}

	async #apply(context: MoveContext, move: MergeQueueMove): Promise<boolean> {
		const workstreamId = context.row.workstreamId;
		switch (move.kind) {
			case 'idle':
				this.#settleRequests(context);
				this.#save(workstreamId, { step: null, lastError: move.problem, nextAttemptAt: null });
				return false;
			case 'wait':
				this.#save(workstreamId, { step: move.step });
				this.#schedule(workstreamId, this.#waitMs(move.step, context.idleness));
				return false;
			case 'backoff':
				this.#schedule(workstreamId, (context.snapshot.backoffUntil ?? 0) - this.#now());
				return false;
			case 'read-pull-request':
			case 'read-base':
				this.#schedule(workstreamId, this.#delays.githubPollMs);
				return false;
			case 'needs-you':
				this.#save(
					workstreamId,
					{
						phase: 'needs-you',
						step: null,
						needsYou: { reason: move.reason, detail: move.detail, jobRunId: move.jobRunId },
					},
					'queued',
				);
				return false;
			case 'run-job':
				await this.#runJob(context, move.builtin, move.signature, move.attempt);
				if (move.builtin === 'update-from-main') {
					this.#settleUpdateRequest(workstreamId, context.updateGeneration);
				}
				return false;
			case 'archive':
				this.#save(workstreamId, { step: 'archiving' });
				await this.#archive(context);
				return false;
			default:
				return this.#act(context, move);
		}
	}

	async #act(context: MoveContext, move: MergeQueueMove): Promise<boolean> {
		const { row, target } = context;
		const workstreamId = row.workstreamId;
		const pullRequestNumber = row.pullRequestNumber ?? 0;
		switch (move.kind) {
			case 'commit':
				await this.#commit(context);
				this.#settlePushRequest(workstreamId, context.pushGeneration);
				break;
			case 'push':
				this.#save(workstreamId, { step: 'pushing' });
				await this.#commitAndPush(context, true);
				break;
			case 'open-draft':
				this.#save(workstreamId, { step: 'opening-draft' });
				await this.#openPullRequest(context);
				break;
			case 'mark-ready':
				this.#save(workstreamId, { step: 'marking-ready' });
				await this.#ops.markReady({ repoId: target.repoId, workstreamId, pullRequestNumber });
				break;
			case 'update-branch': {
				this.#save(workstreamId, { step: 'updating-branch' });
				await this.#context.commands.call('repositories.pull-workstream', {
					workstreamId,
					baseBranch: target.base,
				});
				const updated = await this.#context.commands.call('repositories.workstream-status', {
					workstreamId,
				});
				if (updated.ahead === 0 && updated.operationInProgress === null) {
					this.#recovered(workstreamId);
					this.#save(workstreamId, { step: 'waiting-for-github' });
					this.#schedule(workstreamId, this.#delays.githubPollMs);
					return false;
				}
				break;
			}
			case 'resolve-threads':
				await this.#ops.resolveAddressedReviewThreads({ workstreamId, runId: move.agentRunId });
				this.#settled.delete(workstreamId);
				break;
			case 'merge': {
				this.#save(workstreamId, { step: 'merging' });
				if (await this.#context.commands.call('chat.workstream-has-open-run', { workstreamId })) {
					return true;
				}
				await this.#ops.merge({
					repoId: target.repoId,
					workstreamId,
					pullRequestNumber,
					expectedHeadSha: move.headSha,
					mergeMethod: move.method,
				});
				break;
			}
			default:
				return false;
		}
		this.#recovered(workstreamId);
		return true;
	}

	async #commit(context: MoveContext): Promise<AutomatedPullRequestMetadata> {
		const { row, target, worktree } = context;
		const workstreamId = row.workstreamId;
		const shipContext = workstreamShipContext(this.#context.db, workstreamId);
		const metadata = this.#metadata(target, worktree.dirtyPaths, shipContext);
		if (worktree.dirtyPaths.length > 0 || worktree.operationInProgress === 'merge') {
			const settled = this.#settled.get(workstreamId) ?? null;
			const message = commitMessage(worktree, settled, metadata, target);
			const run = settled
				? settled.agentRunId === null
					? null
					: { id: settled.agentRunId, messageIfAlreadyCommitted: message }
				: metadata.commitRun;
			await this.#context.commands.call('repositories.commit-workstream', {
				workstreamId,
				message,
				...(run ? { run } : {}),
			});
		}
		if (this.#settled.get(workstreamId)?.builtin !== 'address-review') {
			this.#settled.delete(workstreamId);
		}
		return metadata;
	}

	async #commitAndPush(context: MoveContext, retitle: boolean): Promise<void> {
		const { row, target } = context;
		const workstreamId = row.workstreamId;
		const shipContext = workstreamShipContext(this.#context.db, workstreamId);
		const metadata = await this.#commit(context);
		await this.#context.commands.call('repositories.push-workstream', {
			workstreamId,
			expectedRepositoryFullName: target.repository.fullName,
		});
		if (retitle && (shipContext.runSummaries?.length ?? 0) > 0) {
			await this.#retitle(target, workstreamId, metadata.title, metadata.body);
		}
	}

	async #openPullRequest(context: MoveContext): Promise<void> {
		const { row, target } = context;
		const workstreamId = row.workstreamId;
		const head = target.workstream.branch;
		const existing = await this.#ops.status({
			repoId: target.repoId,
			workstreamId,
			head,
			base: target.base,
		});
		if (existing.state === 'open' && existing.number !== null) {
			this.#save(workstreamId, {
				pullRequestNumber: existing.number,
				pullRequestUrl: existing.url,
			});
			return;
		}
		await this.#commitAndPush(context, false);
		const metadata = this.#metadata(
			target,
			context.worktree.dirtyPaths,
			workstreamShipContext(this.#context.db, workstreamId),
		);
		const created = await this.#ops.create({
			repoId: target.repoId,
			workstreamId,
			head,
			base: target.base,
			title: metadata.title,
			body: metadata.body,
			draft: row.phase !== 'queued',
		});
		if (created.number === null) {
			throw new Error('GitHub created the pull request but did not return its number');
		}
		this.#save(workstreamId, {
			pullRequestNumber: created.number,
			pullRequestUrl: created.url,
			generatedTitle: metadata.title,
			generatedBody: metadata.body,
		});
	}

	async #retitle(
		target: ShipTarget,
		workstreamId: string,
		title: string,
		body: string | null,
	): Promise<void> {
		const row = getShip(this.#context.db, workstreamId);
		if (!row?.pullRequestNumber) return;
		const { generatedTitle } = row;
		const generatedBody = body === null ? null : row.generatedBody;
		if (generatedTitle === null && generatedBody === null) return;
		try {
			const owned = await this.#ops.updateMetadata({
				repoId: target.repoId,
				workstreamId,
				pullRequestNumber: row.pullRequestNumber,
				...(generatedTitle === null ? {} : { title: { expected: generatedTitle, next: title } }),
				...(generatedBody === null || body === null
					? {}
					: { body: { expected: generatedBody, next: body } }),
			});
			this.#save(workstreamId, {
				generatedTitle: generatedTitle === null ? null : owned.title,
				...(generatedBody === null ? {} : { generatedBody: owned.body }),
			});
		} catch {
			return;
		}
	}

	async #retitleAfterJob(workstreamId: string): Promise<void> {
		const target = await this.#target(workstreamId);
		const shipContext = workstreamShipContext(this.#context.db, workstreamId);
		await this.#retitle(target, workstreamId, this.#metadata(target, [], shipContext).title, null);
	}

	async #runJob(
		context: MoveContext,
		builtin: JobBuiltin,
		signature: string,
		attempt: number,
	): Promise<void> {
		const { commands } = this.#context;
		const workstreamId = context.row.workstreamId;
		const definitions = await commands.call('jobs.list-definitions', undefined);
		this.#rememberBuiltins(definitions);
		const definition = definitions.find((candidate) => candidate.builtin === builtin);
		if (!definition) throw new Error(`The built-in ${builtin} job is missing`);
		const jobContext = await this.#jobContext(context, builtin);
		const run = await commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId,
			...(jobContext === null ? {} : { context: jobContext }),
			origin: 'merge-queue',
		});
		if (!this.#jobs.has(run.id)) this.#jobs.set(run.id, run);
		this.#settled.delete(workstreamId);
		const saved = this.#save(
			workstreamId,
			{
				activeJobRunId: run.id,
				attempts: attempt,
				failureSignature: signature,
				step: jobStep(builtin),
				lastError: null,
				nextAttemptAt: null,
			},
			context.row.phase,
		);
		this.#failures.delete(workstreamId);
		if (!saved) {
			await commands.call('jobs.cancel-run', { jobRunId: run.id }).catch(() => undefined);
			return;
		}
		const current = this.#jobs.get(run.id) ?? run;
		this.#schedule(
			workstreamId,
			jobIsActive({ builtin, status: current.status }) ? this.#delays.agentPollMs : 0,
		);
	}

	async #jobContext(context: MoveContext, builtin: JobBuiltin): Promise<string | null> {
		const { target, snapshot, row } = context;
		const pullRequestNumber = snapshot.pullRequest?.number ?? row.pullRequestNumber ?? 0;
		switch (builtin) {
			case 'update-from-main':
				return null;
			case 'fix-checks':
				return checkFixJobContext({
					pullRequestNumber,
					failingChecks: snapshot.pullRequest ? blockingFailedChecks(snapshot.pullRequest) : [],
					checkDiagnostics: await this.#ops.checkDiagnostics({
						repoId: target.repoId,
						workstreamId: row.workstreamId,
						pullRequestNumber,
					}),
				});
			case 'address-review':
				return reviewFixJobContext({
					pullRequestNumber,
					reviewFeedback: botReviewFeedback(snapshot.reviewFeedback ?? EMPTY_REVIEW_FEEDBACK),
				});
		}
	}

	async #archive(context: MoveContext): Promise<void> {
		const workstreamId = context.row.workstreamId;
		const pullRequestNumber = context.snapshot.pullRequest?.number ?? context.row.pullRequestNumber;
		const pullRequestUrl = context.snapshot.pullRequest?.url ?? context.row.pullRequestUrl;
		this.#context.events.emit('pull-requests:ship-changed', {
			workstreamId,
			state: null,
			...(pullRequestNumber === null ? {} : { merged: { pullRequestNumber, pullRequestUrl } }),
		});
		await this.#context.commands.call('repositories.archive-workstream', { workstreamId });
		deleteShip(this.#context.db, workstreamId);
		this.#forget(workstreamId);
	}

	#failed(workstreamId: string, error: unknown): void {
		if (this.#disposed) return;
		const row = getShip(this.#context.db, workstreamId);
		if (!row) return;
		const detail = describeError(error);
		if (githubAuthRejected(error)) {
			if (row.phase === 'queued') {
				this.#save(
					workstreamId,
					{
						phase: 'needs-you',
						step: null,
						needsYou: { reason: 'github-reconnect', detail, jobRunId: null },
					},
					'queued',
				);
				return;
			}
			this.#pushRequests.delete(workstreamId);
			this.#save(workstreamId, { step: null, lastError: detail });
			return;
		}
		if (row.phase === 'local') {
			this.#pushRequests.delete(workstreamId);
			this.#updateRequests.delete(workstreamId);
			this.#save(workstreamId, { step: null, lastError: detail });
			return;
		}
		const failures = (this.#failures.get(workstreamId) ?? 0) + 1;
		this.#failures.set(workstreamId, failures);
		const delay = shipBackoffMs(failures, this.#delays);
		this.#save(workstreamId, {
			lastError: detail,
			nextAttemptAt: new Date(this.#now() + delay).toISOString(),
		});
		this.#schedule(workstreamId, delay);
	}

	#recovered(workstreamId: string): void {
		this.#failures.delete(workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (row && (row.lastError !== null || row.nextAttemptAt !== null)) {
			this.#save(workstreamId, { lastError: null, nextAttemptAt: null });
		}
	}

	async #reconcileJob(row: ShipRow): Promise<ShipRow> {
		const jobRunId = row.activeJobRunId;
		if (jobRunId === null) return row;
		if (!this.#jobs.has(jobRunId)) await this.#loadJobs();
		const job = this.#jobs.get(jobRunId);
		if (job && jobIsActive({ builtin: null, status: job.status })) return row;
		const builtin = job ? (this.#builtins.get(job.definitionId) ?? null) : null;
		if (job?.status === 'succeeded') {
			this.#settled.set(row.workstreamId, { builtin, agentRunId: job.agentRunId });
			if (row.phase === 'draft') this.#requestPush(row.workstreamId);
			if (row.pullRequestNumber !== null) await this.#retitleAfterJob(row.workstreamId);
		}
		const interrupted = job?.status === 'failed' && job.detail === JOB_INTERRUPTED_DETAIL;
		const updateFailed =
			builtin === 'update-from-main' && job?.status === 'failed' && row.phase !== 'queued';
		return (
			this.#save(row.workstreamId, {
				activeJobRunId: null,
				...(interrupted ? { attempts: Math.max(0, row.attempts - 1) } : {}),
				...(updateFailed ? { lastError: job.detail } : {}),
			}) ?? row
		);
	}

	#activeJob(row: ShipRow): JobRunRecord | null {
		const job = row.activeJobRunId === null ? null : this.#jobs.get(row.activeJobRunId);
		return job && jobIsActive({ builtin: null, status: job.status }) ? job : null;
	}

	#settledFor(workstreamId: string, worktree: WorktreeStatus): SettledJob | null {
		const settled = this.#settled.get(workstreamId) ?? null;
		const clean =
			worktree.dirtyPaths.length === 0 &&
			worktree.ahead === 0 &&
			worktree.operationInProgress === null;
		if (settled && settled.builtin !== 'address-review' && clean) {
			this.#settled.delete(workstreamId);
			return null;
		}
		return settled;
	}

	#lastJob(workstreamId: string): JobRunRecord | null {
		let last: JobRunRecord | null = null;
		for (const job of this.#jobs.values()) {
			if (job.workstreamId !== workstreamId || job.origin !== 'merge-queue') continue;
			if (last === null || job.createdAt >= last.createdAt) last = job;
		}
		return last;
	}

	async #fixAttemptLimit(): Promise<number> {
		try {
			const settings = await this.#context.commands.call('app.list-settings', undefined);
			return clampedFixAttempts(
				settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING],
				DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
			);
		} catch {
			return DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS;
		}
	}

	// ponytail: main cannot see the renderer prompt queue, so idle waits idleDebounceMs after the last run ends; a main-side prompt queue would make this exact
	async #idleness(workstreamId: string): Promise<Idleness> {
		if (await this.#context.commands.call('chat.workstream-has-open-run', { workstreamId })) {
			return { idle: false, settlesInMs: null };
		}
		const ended = this.#runEndedAt.get(workstreamId);
		const remaining = ended === undefined ? 0 : ended + this.#delays.idleDebounceMs - this.#now();
		return remaining > 0
			? { idle: false, settlesInMs: remaining }
			: { idle: true, settlesInMs: null };
	}

	async #target(workstreamId: string): Promise<ShipTarget> {
		const workstream = getWorkstream(this.#context.db, workstreamId);
		if (!workstream) {
			throw new ShipError('unknown-workstream', `Unknown workstream: ${workstreamId}`);
		}
		const repository = await resolveConnectedRepository(this.#context.db, workstream.projectId);
		if (!repository || githubFullNameFromRemote(repository.remoteUrl ?? '') === null) {
			throw new ShipError(
				'not-github',
				'Connect this workstream to a GitHub repository to open a pull request.',
			);
		}
		return {
			workstream,
			repository,
			repoId: workstream.projectId,
			base: workstream.baseBranch || repository.defaultBranch,
		};
	}

	async #refuseNothingToShip(target: ShipTarget): Promise<void> {
		const workstreamId = target.workstream.id;
		const totals = await this.#context.commands.call('repositories.workstream-change-totals', {
			workstreamId,
			baseBranch: target.base,
		});
		if (totals.files > 0) return;
		const existing = await this.#ops.status({
			repoId: target.repoId,
			workstreamId,
			head: target.workstream.branch,
			base: target.base,
		});
		if (existing.state === 'open') return;
		throw new ShipError('nothing-to-ship', 'This workstream has no changes to ship yet.');
	}

	#metadata(
		target: ShipTarget,
		changedPaths: readonly string[],
		shipContext: PullRequestAutomationContext,
	): AutomatedPullRequestMetadata {
		return automatedPullRequestMetadata({
			branch: target.workstream.branch,
			baseBranch: target.base,
			changedPaths,
			workstreamPath: target.workstream.path,
			context: shipContext,
		});
	}

	#upsert(workstreamId: string, phase: ShipPhase, patch: ShipPatch): ShipStateRecord {
		insertShip(this.#context.db, workstreamId, phase);
		const saved = updateShip(this.#context.db, workstreamId, patch);
		if (!saved) throw new ShipError('unknown-workstream', `Unknown workstream: ${workstreamId}`);
		const state = shipRecord(saved);
		this.#context.events.emit('pull-requests:ship-changed', { workstreamId, state });
		return state;
	}

	#save(workstreamId: string, patch: ShipPatch, onlyInPhase?: ShipPhase): ShipRow | null {
		const { db, events } = this.#context;
		if (this.#disposed) return null;
		const before = getShip(db, workstreamId);
		const after = updateShip(db, workstreamId, patch, onlyInPhase);
		if (!after) return null;
		const state = shipRecord(after);
		if (!before || !sameRecord(shipRecord(before), state)) {
			events.emit('pull-requests:ship-changed', { workstreamId, state });
		}
		return after;
	}

	#requestPush(workstreamId: string): void {
		this.#pushRequests.set(workstreamId, (this.#pushRequests.get(workstreamId) ?? 0) + 1);
	}

	#settlePushRequest(workstreamId: string, generation: number | null): void {
		if (generation !== null && this.#pushRequests.get(workstreamId) === generation) {
			this.#pushRequests.delete(workstreamId);
		}
	}

	#settleUpdateRequest(workstreamId: string, generation: number | null): void {
		if (generation !== null && this.#updateRequests.get(workstreamId) === generation) {
			this.#updateRequests.delete(workstreamId);
		}
	}

	#settleRequests(context: MoveContext): void {
		this.#settlePushRequest(context.row.workstreamId, context.pushGeneration);
		this.#settleUpdateRequest(context.row.workstreamId, context.updateGeneration);
	}

	async #tracked(workstreamId: string): Promise<ShipRow | null> {
		const { db } = this.#context;
		const existing = getShip(db, workstreamId);
		if (existing) return existing;
		if (getWorkstream(db, workstreamId)?.status !== 'active') return null;
		try {
			await this.#target(workstreamId);
		} catch {
			return null;
		}
		insertShip(db, workstreamId, 'local');
		const tracked = getShip(db, workstreamId);
		if (tracked) {
			this.#context.events.emit('pull-requests:ship-changed', {
				workstreamId,
				state: shipRecord(tracked),
			});
		}
		return tracked;
	}

	#rememberBuiltins(definitions: readonly JobDefinitionRecord[]): void {
		for (const definition of definitions) {
			if (definition.builtin !== null) this.#builtins.set(definition.id, definition.builtin);
		}
	}

	#waitMs(step: ShipStep, idleness: Idleness): number {
		switch (step) {
			case 'waiting-for-agent':
				return idleness.settlesInMs ?? this.#delays.agentPollMs;
			case 'waiting-for-checks':
				return this.#delays.checksPollMs;
			case 'waiting-for-review':
				return this.#delays.reviewPollMs;
			case 'fixing-checks':
			case 'updating-from-main':
			case 'addressing-review':
				return this.#delays.agentPollMs;
			default:
				return this.#delays.githubPollMs;
		}
	}

	#schedule(workstreamId: string, delayMs: number): void {
		if (this.#disposed) return;
		this.#clearTimer(workstreamId);
		const timer = setTimeout(
			() => {
				this.#timers.delete(workstreamId);
				this.wake(workstreamId);
			},
			Math.max(0, delayMs),
		);
		timer.unref();
		this.#timers.set(workstreamId, timer);
	}

	#clearTimer(workstreamId: string): void {
		const timer = this.#timers.get(workstreamId);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.#timers.delete(workstreamId);
	}

	#forget(workstreamId: string): void {
		this.#clearTimer(workstreamId);
		this.#pushRequests.delete(workstreamId);
		this.#updateRequests.delete(workstreamId);
		this.#updateRequestedAt.delete(workstreamId);
		this.#runEndedAt.delete(workstreamId);
		this.#settled.delete(workstreamId);
		this.#failures.delete(workstreamId);
	}
}

function commitMessage(
	worktree: WorktreeStatus,
	settled: SettledJob | null,
	metadata: AutomatedPullRequestMetadata,
	target: ShipTarget,
): string {
	if (worktree.operationInProgress === 'merge') {
		return `Merge ${target.base} into ${target.workstream.branch}`;
	}
	if (settled?.builtin === 'fix-checks') return 'Fix failing checks';
	if (settled?.builtin === 'address-review') return 'Address review feedback';
	return metadata.commitMessage;
}

function sameRecord(left: ShipStateRecord, right: ShipStateRecord): boolean {
	return JSON.stringify({ ...left, updatedAt: '' }) === JSON.stringify({ ...right, updatedAt: '' });
}

function githubAuthRejected(error: unknown): boolean {
	return (
		isGhError(error, 'auth-required') ||
		isGhError(error, 'not-installed') ||
		isGitError(error, 'auth-failed') ||
		/\bbad credentials\b|\bHTTP 401\b/iu.test(describeError(error))
	);
}
