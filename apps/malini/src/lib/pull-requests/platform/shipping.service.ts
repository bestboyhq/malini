import {
	APP_STARTED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_TIME_REACHED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import {
	JOB_INTERRUPTED_DETAIL,
	isShippingJobBuiltin,
	type JobRunRecord,
	type ShippingJobBuiltin,
	type ShippingWait,
} from '$contract/jobs';
import {
	DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	SHIP_ALL_BUTTONS,
	UPDATE_FROM_MAIN_TRIGGER_SETTING,
	updateFromMainTrigger,
	type ShipAllClicked,
	type ShipButton,
	type ShipPhase,
	type ShipStateRecord,
	type UpdateFromMainTrigger,
} from '$contract/pull-requests';
import type { PullRequestStatusDto, WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { describeError, isGhError, isGitError } from '$main/errors';
import { workstreamShipContext } from '$lib/chat/chat.platform';
import {
	activeThenJobRun,
	clearAlarm,
	jobDefinition,
	jobDefinitions,
	jobRun,
	latestLoggedEvent,
	latestShippingJobRun,
	setAlarm,
	type DispatchedEvent,
} from '$lib/jobs/jobs.platform';
import {
	automatedPullRequestMetadata,
	getWorkstream,
	recordMergedPullRequest,
	type AutomatedPullRequestMetadata,
	type PullRequestAutomationContext,
} from '$shared/repositories/repositories.platform';
import { checkFixJobContext, reviewFixJobContext } from '../domain/pull-request-fix-prompt';
import {
	DEFAULT_SHIP_DELAYS,
	addressedChangeRequests,
	clampedFixAttempts,
	isUpdateJob,
	jobIsActive,
	jobStep,
	nextShippingMove,
	pullRequestFacts,
	readsBehindBase,
	reviewFeedbackToAddress,
	reviewToAddress,
	shipBackoffMs,
	type ShipDelays,
	type ShippingMove,
	type ShippingSnapshot,
} from '../domain/shipping';
import { field, requireString, requireStrings } from './args';
import type { PullRequestOperations } from './pull-request-operations';
import { PullRequestReader } from './pull-request-reader.service';
import {
	clearShipRequests,
	deleteShip,
	getShip,
	insertShip,
	listShips,
	requestShip,
	settleShipRequest,
	shipRecord,
	updateShip,
	type ShipPatch,
	type ShipRequest,
	type ShipRow,
} from './ship.repository';
import { ShipError, shipTarget, type ShipTarget } from './ship-target';

export interface ShippingOptions {
	delays?: Partial<ShipDelays>;
	now?: () => number;
}

type SettledJob = Readonly<{ builtin: ShippingJobBuiltin | null; agentRunId: string | null }>;

type Idleness = Readonly<{ idle: boolean; settlesInMs: number | null }>;

type MoveContext = Readonly<{
	row: ShipRow;
	target: ShipTarget;
	worktree: WorktreeStatus;
	snapshot: ShippingSnapshot;
	idleness: Idleness;
	wokenBy: number | null;
}>;

const MAX_MOVES_PER_WAKE = 10;

const FRESH_READ_MS = 2_000;

export class Shipping {
	readonly #context: MainContext;
	readonly #ops: PullRequestOperations;
	readonly #delays: ShipDelays;
	readonly #now: () => number;
	readonly #reader: PullRequestReader;
	readonly #running = new Map<string, Promise<void>>();
	readonly #again = new Set<string>();
	readonly #runEndedAt = new Map<string, number>();
	readonly #openedAt = new Map<string, number>();
	readonly #wokenBy = new Map<string, number>();
	#disposed = false;

	constructor(
		context: MainContext,
		operations: PullRequestOperations,
		options: ShippingOptions = {},
	) {
		this.#context = context;
		this.#ops = operations;
		this.#delays = { ...DEFAULT_SHIP_DELAYS, ...options.delays };
		this.#now = options.now ?? Date.now;
		this.#reader = new PullRequestReader(context, operations, this.#delays, this.#now, (id) =>
			this.#pullRequestGone(id),
		);
	}

	async handle(event: DispatchedEvent): Promise<void> {
		const { channel, payload } = event;
		if (channel === APP_STARTED_CHANNEL) {
			this.#resume(event);
			return;
		}
		if (channel === JOBS_RUN_FINISHED_CHANNEL) {
			await this.#runFinished(payload, event);
			return;
		}
		const workstreamId = stringField(payload, 'workstreamId');
		if (workstreamId === null) return;
		switch (channel) {
			case PULL_REQUESTS_BUTTON_CLICKED_CHANNEL:
				await this.#buttonClicked(workstreamId, event);
				return;
			case JOBS_TIME_REACHED_CHANNEL:
				this.#wake(workstreamId, event);
				return;
			case PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL:
				await this.#opened(workstreamId, event);
				return;
			case PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL:
				await this.#pullRequestChanged(workstreamId, payload, event);
				return;
			case CHAT_TURN_FINISHED_CHANNEL:
				await this.#workEnded(workstreamId, event);
				return;
			case REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL:
				if (getShip(this.#context.db, workstreamId)?.phase === 'needs-you') {
					this.#wake(workstreamId, event);
				}
				return;
			case REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL:
				this.workstreamRemoved(workstreamId);
				return;
			default:
				return;
		}
	}

	report(workstreamId: string, pullRequest: PullRequestStatusDto): void {
		this.#reader.report(workstreamId, pullRequest);
	}

	dispose(): void {
		this.#disposed = true;
		this.#reader.dispose();
	}

	states(): ShipStateRecord[] {
		return listShips(this.#context.db).map(shipRecord);
	}

	async clicked(workstreamId: string, button: ShipButton): Promise<ShipStateRecord | null> {
		this.#reader.forget(workstreamId);
		switch (button) {
			case 'draft':
				return this.openDraft(workstreamId, button);
			case 'merge':
				return this.queueMerge(workstreamId, button);
			case 'retry':
				return this.#retryMerge(workstreamId);
			case 'cancel':
				return this.#cancelMerge(workstreamId);
		}
	}

	async openDraft(workstreamId: string, click: ShipButton | null = null): Promise<ShipStateRecord> {
		const target = await shipTarget(this.#context.db, workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (row && row.phase !== 'draft' && row.phase !== 'local') {
			return this.#unchanged(row, click);
		}
		if (row?.pullRequestNumber == null) await this.#refuseNothingToShip(target);
		insertShip(this.#context.db, workstreamId, 'draft');
		requestShip(this.#context.db, workstreamId, 'push');
		return this.#upsert(workstreamId, click, {
			phase: 'draft',
			step: row?.pullRequestNumber == null ? 'opening-draft' : 'pushing',
			lastError: null,
			nextAttemptAt: null,
			failures: 0,
		});
	}

	async queueMerge(
		workstreamId: string,
		click: ShipButton | null = null,
	): Promise<ShipStateRecord> {
		const target = await shipTarget(this.#context.db, workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (row?.phase === 'queued') return this.#unchanged(row, click);
		if (row?.pullRequestNumber == null) await this.#refuseNothingToShip(target);
		insertShip(this.#context.db, workstreamId, 'queued');
		return this.#upsert(workstreamId, click, {
			phase: 'queued',
			step: null,
			queuedAt: new Date(this.#now()).toISOString(),
			attempts: 0,
			failureSignature: null,
			needsYou: null,
			lastError: null,
			nextAttemptAt: null,
			failures: 0,
		});
	}

	workstreamRemoved(workstreamId: string): void {
		deleteShip(this.#context.db, workstreamId);
		this.#forget(workstreamId);
	}

	async #retryMerge(workstreamId: string): Promise<ShipStateRecord> {
		const row = getShip(this.#context.db, workstreamId);
		if (!row) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
		if (row.phase !== 'needs-you') return this.#unchanged(row, 'retry');
		const saved = this.#save(
			workstreamId,
			{
				phase: 'queued',
				step: null,
				needsYou: null,
				queuedAt: row.queuedAt ?? new Date(this.#now()).toISOString(),
				attempts: 0,
				failureSignature: null,
				lastError: null,
				nextAttemptAt: null,
				failures: 0,
			},
			undefined,
			'retry',
		);
		if (!saved) throw new ShipError('not-queued', 'Nothing is queued to merge in this workstream.');
		return shipRecord(saved);
	}

	async #cancelMerge(workstreamId: string): Promise<ShipStateRecord | null> {
		const row = getShip(this.#context.db, workstreamId);
		if (!row) {
			this.#clicked(workstreamId, 'cancel', null);
			return null;
		}
		if (row.phase === 'draft' || row.phase === 'local') return this.#unchanged(row, 'cancel');
		const saved = this.#save(
			workstreamId,
			{
				phase: row.pullRequestNumber === null ? 'local' : 'draft',
				step: null,
				needsYou: null,
				queuedAt: null,
				attempts: 0,
				failureSignature: null,
				activeJobRunId: null,
				lastError: null,
				nextAttemptAt: null,
				failures: 0,
			},
			undefined,
			'cancel',
		);
		clearShipRequests(this.#context.db, workstreamId);
		clearAlarm(this.#context.db, alarmKey(workstreamId));
		this.#reader.watch(workstreamId);
		if (row.activeJobRunId) {
			await this.#context.commands
				.call('jobs.cancel-run', { jobRunId: row.activeJobRunId })
				.catch(() => undefined);
		}
		return saved ? shipRecord(saved) : null;
	}

	#resume(event: DispatchedEvent): void {
		for (const row of listShips(this.#context.db)) {
			if (row.phase === 'draft' && row.step !== null) {
				requestShip(this.#context.db, row.workstreamId, 'push');
			}
			const pending =
				row.phase === 'queued' ||
				row.phase === 'needs-you' ||
				row.activeJobRunId !== null ||
				(row.phase === 'draft' && row.step !== null) ||
				row.requests.push + row.requests.update + row.requests.review > 0;
			if (pending) this.#wake(row.workstreamId, event);
		}
	}

	async #buttonClicked(workstreamId: string, event: DispatchedEvent): Promise<void> {
		const all = shipAllClicked(event.payload);
		if (all === null) {
			this.#wake(workstreamId, event);
			return;
		}
		const builtin = all.button === 'draft-all' ? 'open-draft' : 'merge';
		const definition = jobDefinitions(this.#context.db).find(
			(candidate) => candidate.builtin === builtin,
		);
		if (!definition) throw new Error(`The built-in ${builtin} job is missing`);
		await Promise.all(
			all.workstreamIds.map((started) =>
				this.#context.commands.call('jobs.run', {
					definitionId: definition.id,
					workstreamId: started,
					origin: 'merge-queue',
					...(all.chatSessionId === null ? {} : { chatSessionId: all.chatSessionId }),
					...(event.id === null ? {} : { causeEventId: event.id }),
				}),
			),
		);
	}

	async #opened(workstreamId: string, event: DispatchedEvent): Promise<void> {
		const last = this.#openedAt.get(workstreamId);
		if (last !== undefined && this.#now() - last < this.#delays.openedCheckMs) return;
		if ((await this.#updateTrigger()) === 'merging') return;
		this.#openedAt.set(workstreamId, this.#now());
		await this.#request(workstreamId, 'update', event);
	}

	async #pullRequestChanged(
		workstreamId: string,
		payload: unknown,
		event: DispatchedEvent,
	): Promise<void> {
		const facts = pullRequestFacts(payload);
		if (facts === null) return;
		if (readsBehindBase(facts) && (await this.#updateTrigger()) === 'main-moves') {
			await this.#request(workstreamId, 'update', event);
		}
		const open = facts.state === 'open' || facts.state === 'draft';
		if (open && facts.reviewDecision === 'changes_requested') {
			await this.#request(workstreamId, 'review', event);
		}
		if (getShip(this.#context.db, workstreamId)) this.#wake(workstreamId, event);
	}

	async #workEnded(workstreamId: string, event: DispatchedEvent): Promise<void> {
		this.#runEndedAt.set(workstreamId, this.#now());
		const row = await this.#tracked(workstreamId);
		if (!row) return;
		if (row.phase === 'local' || row.phase === 'draft') {
			requestShip(this.#context.db, workstreamId, 'push');
		}
		this.#wake(workstreamId, event);
	}

	async #runFinished(payload: unknown, event: DispatchedEvent): Promise<void> {
		const runId = isRecord(payload) ? stringField(payload['run'], 'id') : null;
		const run = runId === null ? null : jobRun(this.#context.db, runId);
		if (!run || run.workstreamId === null) return;
		const row = getShip(this.#context.db, run.workstreamId);
		if (row?.activeJobRunId === run.id || run.origin === 'merge-queue') {
			this.#wake(run.workstreamId, event);
			return;
		}
		if (run.agentRunId !== null) {
			await this.#workEnded(run.workstreamId, event);
			return;
		}
		if (row) this.#wake(run.workstreamId, event);
	}

	async #request(
		workstreamId: string,
		request: ShipRequest,
		event: DispatchedEvent,
	): Promise<void> {
		const row = await this.#tracked(workstreamId);
		if (!row || (row.phase !== 'local' && row.phase !== 'draft')) return;
		requestShip(this.#context.db, workstreamId, request);
		this.#wake(workstreamId, event);
	}

	#pullRequestGone(workstreamId: string): void {
		const row = getShip(this.#context.db, workstreamId);
		if (row?.phase !== 'draft' || row.step !== null || row.pullRequestNumber === null) return;
		deleteShip(this.#context.db, workstreamId);
		this.#forget(workstreamId);
		this.#context.events.emit('pull-requests:ship-changed', { workstreamId, state: null });
	}

	#wake(workstreamId: string, event: DispatchedEvent): void {
		if (this.#disposed) return;
		if (event.id !== null) this.#wokenBy.set(workstreamId, event.id);
		if (this.#running.has(workstreamId)) {
			this.#again.add(workstreamId);
			return;
		}
		const drain = this.#drain(workstreamId).finally(() => {
			this.#running.delete(workstreamId);
			this.#reader.watch(workstreamId);
		});
		this.#running.set(workstreamId, drain);
	}

	async #drain(workstreamId: string): Promise<void> {
		do {
			this.#again.delete(workstreamId);
			await this.#advance(workstreamId, this.#wokenBy.get(workstreamId) ?? null);
		} while (this.#again.has(workstreamId) && !this.#disposed);
	}

	async #advance(workstreamId: string, wokenBy: number | null): Promise<void> {
		for (let moves = 0; moves < MAX_MOVES_PER_WAKE; moves += 1) {
			if (this.#disposed) return;
			let progressed: boolean;
			try {
				progressed = await this.#step(workstreamId, wokenBy);
			} catch (error) {
				progressed = false;
				this.#failed(workstreamId, error);
			}
			if (!progressed) return;
		}
		this.#alarm(workstreamId, 'retry', this.#now() + this.#delays.githubPollMs);
	}

	async #step(workstreamId: string, wokenBy: number | null): Promise<boolean> {
		const { db, commands } = this.#context;
		const found = getShip(db, workstreamId);
		if (!found) return false;
		if (!getWorkstream(db, workstreamId)) {
			this.workstreamRemoved(workstreamId);
			return false;
		}
		const row = await this.#reconcileJob(found);
		const { requests } = row;
		const working = row.phase === 'local' || row.phase === 'draft';
		if (
			working &&
			requests.push === 0 &&
			requests.update === 0 &&
			requests.review === 0 &&
			row.activeJobRunId === null
		) {
			this.#save(workstreamId, { step: null });
			return false;
		}
		const target = await shipTarget(db, workstreamId);
		const idleness = await this.#idleness(workstreamId);
		const worktree = await commands.call('repositories.workstream-status', { workstreamId });
		const settled = this.#settledFor(row, worktree);
		const job = this.#activeJob(row);
		const lastJob = latestShippingJobRun(db, workstreamId);
		const recheck = row.phase === 'needs-you';
		let snapshot: ShippingSnapshot = {
			phase: recheck ? 'queued' : row.phase,
			pushRequested: requests.push > 0,
			updateRequested: requests.update > 0,
			reviewRequested: requests.review > 0,
			addressedReviews: row.addressedReviews,
			behindBase: null,
			pullRequestNumber: row.pullRequestNumber,
			idle: idleness.idle,
			job: job ? { builtin: this.#builtin(job), status: job.status } : null,
			lastJobRunId: lastJob?.id ?? null,
			lastJobBuiltin: lastJob ? this.#builtin(lastJob) : null,
			settledJob: settled?.builtin ?? null,
			worktree,
			threadResolutionRunId: settled?.builtin === 'address-review' ? settled.agentRunId : null,
			failureSignature: row.failureSignature,
			fixSucceededAt:
				lastJob?.status === 'succeeded' && lastJob.finishedAt !== null
					? Date.parse(lastJob.finishedAt)
					: null,
			attempts: row.attempts,
			fixAttemptLimit: working ? DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS : await this.#fixAttemptLimit(),
			backoffUntil: row.nextAttemptAt === null ? null : Date.parse(row.nextAttemptAt),
			now: this.#now(),
			read: false,
			pullRequest: null,
		};
		if (this.#jobMovedOn(row)) return true;
		if (recheck) {
			const read = await this.#reader.read(workstreamId, FRESH_READ_MS);
			if (!read.read) return false;
			snapshot = { ...snapshot, read: true, pullRequest: read.pullRequest };
		}
		let move = nextShippingMove(snapshot);
		if (move.kind === 'read-base') {
			snapshot = { ...snapshot, behindBase: await this.#behindBase(workstreamId, target) };
			move = nextShippingMove(snapshot);
		}
		if (move.kind === 'read-pull-request') {
			const read = await this.#reader.read(workstreamId, FRESH_READ_MS);
			if (!read.read) {
				this.#save(workstreamId, {
					step: row.phase === 'queued' ? 'waiting-for-checks' : 'waiting-for-github',
				});
				return false;
			}
			snapshot = { ...snapshot, read: true, pullRequest: read.pullRequest };
			move = nextShippingMove(snapshot);
		}
		const context: MoveContext = { row, target, worktree, snapshot, idleness, wokenBy };
		if (recheck) return this.#recheck(context, move);
		return this.#apply(context, move);
	}

	async #behindBase(workstreamId: string, target: ShipTarget): Promise<number> {
		return this.#context.commands.call('repositories.count-behind-base', {
			workstreamId,
			baseBranch: target.base,
		});
	}

	#recheck(context: MoveContext, move: ShippingMove): boolean {
		const { row } = context;
		const unchanged =
			(move.kind === 'needs-you' && move.reason === row.needsYou?.reason) ||
			(move.kind === 'wait' && move.step === 'waiting-for-agent') ||
			move.kind === 'backoff';
		if (unchanged) return false;
		const resumed = this.#save(
			row.workstreamId,
			{ phase: 'queued', step: null, needsYou: null, lastError: null, nextAttemptAt: null },
			'needs-you',
		);
		return resumed !== null;
	}

	async #apply(context: MoveContext, move: ShippingMove): Promise<boolean> {
		const workstreamId = context.row.workstreamId;
		switch (move.kind) {
			case 'idle':
				this.#settleRequests(context.row);
				this.#save(workstreamId, { step: null, lastError: move.problem, nextAttemptAt: null });
				return false;
			case 'wait':
				this.#save(workstreamId, { step: move.step });
				if (move.until !== undefined) this.#alarm(workstreamId, 'checks', move.until);
				if (move.step === 'waiting-for-agent' && context.idleness.settlesInMs !== null) {
					await sleep(context.idleness.settlesInMs);
					return !this.#disposed;
				}
				return false;
			case 'backoff':
				this.#alarm(workstreamId, 'retry', context.snapshot.backoffUntil ?? this.#now());
				return false;
			case 'read-pull-request':
			case 'read-base':
				this.#save(workstreamId, { step: 'waiting-for-github' });
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
					settleShipRequest(this.#context.db, workstreamId, 'update', context.row.requests.update);
				}
				if (move.builtin === 'address-review') {
					settleShipRequest(this.#context.db, workstreamId, 'review', context.row.requests.review);
				}
				return false;
			case 'land':
				this.#land(context);
				return false;
			default:
				return this.#act(context, move);
		}
	}

	async #act(context: MoveContext, move: ShippingMove): Promise<boolean> {
		const { row, target } = context;
		const workstreamId = row.workstreamId;
		const pullRequestNumber = row.pullRequestNumber ?? 0;
		switch (move.kind) {
			case 'commit':
				await this.#commit(context);
				settleShipRequest(this.#context.db, workstreamId, 'push', row.requests.push);
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
					this.#reader.forget(workstreamId);
					this.#save(workstreamId, { step: 'waiting-for-github' });
					return false;
				}
				break;
			}
			case 'resolve-threads':
				await this.#ops.resolveAddressedReviewThreads({ workstreamId, runId: move.agentRunId });
				this.#save(workstreamId, { settledJobRunId: null });
				break;
			case 'merge': {
				this.#save(workstreamId, { step: 'merging' });
				if (
					await this.#context.commands.call('chat.workstream-has-working-run', { workstreamId })
				) {
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
		this.#reader.forget(workstreamId);
		this.#recovered(workstreamId);
		return true;
	}

	async #commit(context: MoveContext): Promise<AutomatedPullRequestMetadata> {
		const { row, target, worktree } = context;
		const workstreamId = row.workstreamId;
		const shipContext = workstreamShipContext(this.#context.db, workstreamId);
		const metadata = this.#metadata(target, worktree.dirtyPaths, shipContext);
		const settled = this.#settled(row);
		if (worktree.dirtyPaths.length > 0 || worktree.operationInProgress === 'merge') {
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
		if (settled !== null && settled.builtin !== 'address-review') {
			this.#save(workstreamId, { settledJobRunId: null });
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
		const target = await shipTarget(this.#context.db, workstreamId);
		const shipContext = workstreamShipContext(this.#context.db, workstreamId);
		await this.#retitle(target, workstreamId, this.#metadata(target, [], shipContext).title, null);
	}

	async #runJob(
		context: MoveContext,
		builtin: ShippingJobBuiltin,
		signature: string,
		attempt: number,
	): Promise<void> {
		const { db, commands } = this.#context;
		const workstreamId = context.row.workstreamId;
		const definition = jobDefinitions(db).find((candidate) => candidate.builtin === builtin);
		if (!definition) throw new Error(`The built-in ${builtin} job is missing`);
		const jobContext = await this.#jobContext(context, builtin);
		const causeEventId =
			builtin === 'update-from-main'
				? context.wokenBy
				: this.#cause(
						workstreamId,
						context.snapshot.pullRequest?.pullRequestNumber ?? context.row.pullRequestNumber,
						context.wokenBy,
					);
		const run = await commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId,
			...(jobContext === null ? {} : { context: jobContext }),
			origin: 'merge-queue',
			...(causeEventId === null ? {} : { causeEventId }),
		});
		const started: ShipPatch = {
			activeJobRunId: run.id,
			attempts: attempt,
			failureSignature: signature,
			step: jobStep(builtin),
			lastError: null,
			nextAttemptAt: null,
			failures: 0,
			settledJobRunId: null,
		};
		const saved =
			this.#save(workstreamId, started, context.row.phase) ??
			(context.row.phase === 'queued' ? null : this.#save(workstreamId, started, 'queued'));
		if (!saved) await commands.call('jobs.cancel-run', { jobRunId: run.id }).catch(() => undefined);
	}

	#cause(
		workstreamId: string,
		pullRequestNumber: number | null,
		wokenBy: number | null,
	): number | null {
		const { db } = this.#context;
		const read = latestLoggedEvent(db, PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL, workstreamId);
		const payload = read?.payload;
		if (
			read &&
			pullRequestNumber !== null &&
			isRecord(payload) &&
			payload['pullRequestNumber'] === pullRequestNumber
		) {
			return read.id;
		}
		return wokenBy;
	}

	async #jobContext(context: MoveContext, builtin: ShippingJobBuiltin): Promise<string | null> {
		const { target, snapshot, row } = context;
		const pullRequestNumber = snapshot.pullRequest?.pullRequestNumber ?? row.pullRequestNumber ?? 0;
		switch (builtin) {
			case 'update-from-main':
			case 'resolve-conflicts':
				return null;
			case 'fix-checks':
				return checkFixJobContext({
					pullRequestNumber,
					failingChecks: (snapshot.pullRequest?.blockingChecks ?? []).map((check) => ({
						name: check.name,
						appId: check.appId,
						conclusion: check.state,
						state: check.state,
						required: check.required,
					})),
					checkDiagnostics: await this.#ops.checkDiagnostics({
						repoId: target.repoId,
						workstreamId: row.workstreamId,
						pullRequestNumber,
					}),
				});
			case 'address-review': {
				const feedback = await this.#ops.reviewFeedback({
					repoId: target.repoId,
					workstreamId: row.workstreamId,
					pullRequestNumber,
				});
				return reviewFixJobContext({
					pullRequestNumber,
					reviewFeedback: snapshot.pullRequest
						? reviewFeedbackToAddress(
								feedback,
								reviewToAddress(snapshot.pullRequest, snapshot.addressedReviews),
							)
						: feedback,
				});
			}
		}
	}

	#land(context: MoveContext): void {
		const workstreamId = context.row.workstreamId;
		const pullRequestNumber =
			context.snapshot.pullRequest?.pullRequestNumber ?? context.row.pullRequestNumber;
		const pullRequestUrl =
			context.snapshot.pullRequest?.pullRequestUrl ?? context.row.pullRequestUrl;
		if (pullRequestNumber !== null) {
			recordMergedPullRequest(this.#context.db, workstreamId, {
				number: pullRequestNumber,
				url: pullRequestUrl,
			});
		}
		this.#context.events.emit('pull-requests:ship-changed', {
			workstreamId,
			state: null,
			...(pullRequestNumber === null ? {} : { merged: { pullRequestNumber, pullRequestUrl } }),
		});
		deleteShip(this.#context.db, workstreamId);
		this.#forget(workstreamId);
	}

	#failed(workstreamId: string, error: unknown): void {
		if (this.#disposed) return;
		this.#reader.forget(workstreamId);
		const row = getShip(this.#context.db, workstreamId);
		if (!row) return;
		const detail = describeError(error);
		const failures = row.failures + 1;
		const due = this.#now() + shipBackoffMs(failures, this.#delays);
		if (row.phase === 'needs-you') {
			this.#save(workstreamId, { failures });
			this.#alarm(workstreamId, 'retry', due);
			return;
		}
		if (githubAuthRejected(error)) {
			if (row.phase === 'queued') {
				this.#save(
					workstreamId,
					{
						phase: 'needs-you',
						step: null,
						needsYou: { reason: 'github-reconnect', detail, jobRunId: null },
						failures,
					},
					'queued',
				);
				this.#alarm(workstreamId, 'retry', due);
				return;
			}
			settleShipRequest(this.#context.db, workstreamId, 'push', row.requests.push);
			this.#save(workstreamId, { step: null, lastError: detail });
			return;
		}
		if (row.phase === 'local') {
			clearShipRequests(this.#context.db, workstreamId);
			this.#save(workstreamId, { step: null, lastError: detail });
			return;
		}
		this.#save(workstreamId, {
			lastError: detail,
			nextAttemptAt: new Date(due).toISOString(),
			failures,
		});
		this.#alarm(workstreamId, 'retry', due);
	}

	#recovered(workstreamId: string): void {
		const row = getShip(this.#context.db, workstreamId);
		if (row && (row.lastError !== null || row.nextAttemptAt !== null || row.failures > 0)) {
			this.#save(workstreamId, { lastError: null, nextAttemptAt: null, failures: 0 });
		}
	}

	async #reconcileJob(row: ShipRow): Promise<ShipRow> {
		const jobRunId = row.activeJobRunId;
		if (jobRunId === null) return row;
		const { db } = this.#context;
		const job = jobRun(db, jobRunId);
		if (job && jobIsActive({ builtin: null, status: job.status })) return row;
		const child = job ? activeThenJobRun(db, job.id) : null;
		if (child) {
			return (
				this.#save(row.workstreamId, {
					activeJobRunId: child.id,
					step: jobStep(this.#builtin(child)),
				}) ?? row
			);
		}
		const builtin = job ? this.#builtin(job) : null;
		const addressed =
			job?.status === 'succeeded' && builtin === 'address-review'
				? addressedChangeRequests(row.failureSignature)
				: [];
		if (job?.status === 'succeeded') {
			if (row.phase === 'draft') requestShip(db, row.workstreamId, 'push');
			if (row.pullRequestNumber !== null) await this.#retitleAfterJob(row.workstreamId);
		}
		const interrupted = job?.status === 'failed' && job.detail === JOB_INTERRUPTED_DETAIL;
		const updateFailed = isUpdateJob(builtin) && job?.status === 'failed' && row.phase !== 'queued';
		return (
			this.#save(row.workstreamId, {
				activeJobRunId: null,
				settledJobRunId: job?.status === 'succeeded' ? job.id : row.settledJobRunId,
				...(addressed.length > 0
					? { addressedReviews: [...new Set([...row.addressedReviews, ...addressed])] }
					: {}),
				...(interrupted ? { attempts: Math.max(0, row.attempts - 1) } : {}),
				...(updateFailed ? { lastError: job.detail } : {}),
			}) ?? row
		);
	}

	#jobMovedOn(row: ShipRow): boolean {
		const current = getShip(this.#context.db, row.workstreamId);
		return (
			current?.activeJobRunId !== row.activeJobRunId ||
			(row.activeJobRunId !== null && this.#activeJob(row) === null)
		);
	}

	#activeJob(row: ShipRow): JobRunRecord | null {
		const job = row.activeJobRunId === null ? null : jobRun(this.#context.db, row.activeJobRunId);
		return job && jobIsActive({ builtin: null, status: job.status }) ? job : null;
	}

	#settled(row: ShipRow): SettledJob | null {
		const current = getShip(this.#context.db, row.workstreamId) ?? row;
		const job =
			current.settledJobRunId === null ? null : jobRun(this.#context.db, current.settledJobRunId);
		return job ? { builtin: this.#builtin(job), agentRunId: job.agentRunId } : null;
	}

	#settledFor(row: ShipRow, worktree: WorktreeStatus): SettledJob | null {
		const settled = this.#settled(row);
		const clean =
			worktree.dirtyPaths.length === 0 &&
			worktree.ahead === 0 &&
			worktree.operationInProgress === null;
		if (settled && settled.builtin !== 'address-review' && clean) {
			this.#save(row.workstreamId, { settledJobRunId: null });
			return null;
		}
		return settled;
	}

	#builtin(run: JobRunRecord): ShippingJobBuiltin | null {
		const builtin = jobDefinition(this.#context.db, run.definitionId)?.builtin ?? null;
		return isShippingJobBuiltin(builtin) ? builtin : null;
	}

	async #fixAttemptLimit(): Promise<number> {
		const settings = await this.#settings();
		return clampedFixAttempts(
			settings[MERGE_QUEUE_FIX_ATTEMPTS_SETTING],
			DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS,
		);
	}

	async #updateTrigger(): Promise<UpdateFromMainTrigger> {
		const settings = await this.#settings();
		return updateFromMainTrigger(settings[UPDATE_FROM_MAIN_TRIGGER_SETTING]);
	}

	#settings(): Promise<Record<string, string>> {
		return this.#context.commands
			.call('app.list-settings', undefined)
			.catch((): Record<string, string> => ({}));
	}

	// ponytail: main cannot see the renderer prompt queue, so idle waits idleDebounceMs after the last turn ends; a main-side prompt queue would make this exact
	async #idleness(workstreamId: string): Promise<Idleness> {
		if (await this.#context.commands.call('chat.workstream-has-working-run', { workstreamId })) {
			return { idle: false, settlesInMs: null };
		}
		const ended = this.#runEndedAt.get(workstreamId);
		const remaining = ended === undefined ? 0 : ended + this.#delays.idleDebounceMs - this.#now();
		return remaining > 0
			? { idle: false, settlesInMs: remaining }
			: { idle: true, settlesInMs: null };
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

	#upsert(workstreamId: string, click: ShipButton | null, patch: ShipPatch): ShipStateRecord {
		const saved = updateShip(this.#context.db, workstreamId, patch);
		if (!saved) throw new ShipError('unknown-workstream', `Unknown workstream: ${workstreamId}`);
		const state = shipRecord(saved);
		if (click === null)
			this.#context.events.emit('pull-requests:ship-changed', { workstreamId, state });
		else this.#clicked(workstreamId, click, state);
		return state;
	}

	#unchanged(row: ShipRow, click: ShipButton | null): ShipStateRecord {
		const state = shipRecord(row);
		if (click !== null) this.#clicked(row.workstreamId, click, state);
		return state;
	}

	#clicked(workstreamId: string, button: ShipButton, state: ShipStateRecord | null): void {
		this.#context.events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, {
			workstreamId,
			button,
			state,
		});
	}

	#save(
		workstreamId: string,
		patch: ShipPatch,
		onlyInPhase?: ShipPhase,
		click?: ShipButton,
	): ShipRow | null {
		const { db, events } = this.#context;
		if (this.#disposed) return null;
		const before = getShip(db, workstreamId);
		const after = updateShip(db, workstreamId, patch, onlyInPhase);
		if (!after) return null;
		const state = shipRecord(after);
		if (click) this.#clicked(workstreamId, click, state);
		else if (!before || !sameRecord(shipRecord(before), state)) {
			events.emit('pull-requests:ship-changed', { workstreamId, state });
		}
		return after;
	}

	#alarm(workstreamId: string, wait: ShippingWait, due: number): void {
		if (this.#disposed) return;
		setAlarm(this.#context.db, alarmKey(workstreamId), {
			workstreamId,
			wait,
			due: new Date(Math.max(due, this.#now())).toISOString(),
		});
	}

	#settleRequests(row: ShipRow): void {
		const { db } = this.#context;
		settleShipRequest(db, row.workstreamId, 'push', row.requests.push);
		settleShipRequest(db, row.workstreamId, 'update', row.requests.update);
		settleShipRequest(db, row.workstreamId, 'review', row.requests.review);
	}

	async #tracked(workstreamId: string): Promise<ShipRow | null> {
		const { db } = this.#context;
		const existing = getShip(db, workstreamId);
		if (existing) return existing;
		if (getWorkstream(db, workstreamId)?.status !== 'active') return null;
		try {
			await shipTarget(db, workstreamId);
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

	#forget(workstreamId: string): void {
		this.#runEndedAt.delete(workstreamId);
		this.#openedAt.delete(workstreamId);
		this.#wokenBy.delete(workstreamId);
		this.#reader.forget(workstreamId);
		this.#reader.watch(workstreamId);
		clearAlarm(this.#context.db, alarmKey(workstreamId));
	}
}

export function shipAllClicked(args: unknown): ShipAllClicked | null {
	const button = SHIP_ALL_BUTTONS.find((candidate) => candidate === field(args, 'button'));
	if (button === undefined) return null;
	return {
		workstreamId: requireString(args, 'workstreamId'),
		button,
		workstreamIds: requireStrings(args, 'workstreamIds'),
		chatSessionId:
			(field(args, 'chatSessionId') ?? null) === null ? null : requireString(args, 'chatSessionId'),
	};
}

function alarmKey(workstreamId: string): string {
	return `shipping:${workstreamId}`;
}

function stringField(payload: unknown, key: string): string | null {
	if (!isRecord(payload)) return null;
	const value = payload[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, Math.max(0, ms)).unref();
	});
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
