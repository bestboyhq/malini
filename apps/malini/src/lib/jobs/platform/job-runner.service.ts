import type { AgentEventEnvelope } from '$contract/agent';
import {
	PAUSED_FOR_EXIT_ERROR,
	foldSessionStatus,
	isCancellationError,
	isPausedRunEvent,
	type LifecycleEnvelope,
	type SessionStatus,
} from '$contract/agent-state-machine';
import {
	CHAT_AGENT_EVENT_CHANNEL,
	JOBS_RUN_CHANGED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	JOBS_RUN_STARTED_CHANNEL,
} from '$contract/events';
import type { Workstream, WorktreeStatus } from '$contract/repositories';
import {
	JOB_INTERRUPTED_DETAIL,
	JOBS_MAX_CONCURRENT_SETTING,
	isAgentlessJobBuiltin,
	type AgentlessJobBuiltin,
	type JobRunChangedEvent,
	type JobRunRecord,
	type JobRunStatus,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { CommandOutcome } from '$main/ipc/registry';
import {
	clonePlannedRepository,
	createPlannedWorkstream,
	getWorkstream,
	isWorkstreamClosed,
	nextWorkstreamId,
	planRepositoryWorkstream,
	prepareStartedWorkstream,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import {
	agentRunWasAlreadyGone,
	foldedJobContext,
	isFinishedJobRunStatus,
	jobPrompt,
	jobsMaxConcurrent,
	truncateJobContext,
	workstreamWasBusy,
} from '../domain/job-run';
import { updateFromMainJobContext } from '../domain/update-from-main-context';
import { triggeredBefore } from './event-log.repository';
import { findString, type DispatchedEvent } from './event-log.service';
import { getBuiltinJobDefinition, getJobDefinition } from './job-definitions.repository';
import {
	appendJobRunContext,
	childJobRun,
	findActiveJobRunForSession,
	getJobRun,
	getJobRunContext,
	insertJobRun,
	listUnfinishedJobRuns,
	saveJobRun,
} from './job-runs.repository';
import {
	hasTurnReport,
	resumesTurn,
	turnEndedOverBackgroundCommands,
} from '$lib/chat/chat.platform';
import { chooseSessionSkills } from '$lib/skills/skills.platform';

const SAFETY_INTERVAL_MS = 15_000;

const SHIPPING = {
	'open-draft': {
		command: 'pull-requests.open-draft',
		opening: 'Malini opens the draft pull request once the workstream is idle.',
		pushing: 'Malini pushes to',
	},
	merge: {
		command: 'pull-requests.queue-merge',
		opening: 'Queued to merge. Malini opens the pull request once the workstream is idle.',
		pushing: 'Queued to merge:',
	},
} as const satisfies Record<Exclude<AgentlessJobBuiltin, 'update-from-main'>, object>;

export const BUSY_RETRY_MS = 3_000;

export const WORKSTREAM_CLOSED = 'Its workstream was closed.';

type SessionState = Readonly<{
	status: SessionStatus;
	runId: string | null;
	summary: string | null;
	paused: boolean;
}>;

export class JobRunner {
	readonly #context: MainContext;
	readonly #log: (line: string) => void;
	readonly #pendingRequests = new Map<string, Set<string>>();
	readonly #waitingRuns = new Map<string, string>();
	readonly #retryAt = new Map<string, number>();
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	readonly #unsubscribes: Array<() => void> = [];
	#safety: ReturnType<typeof setTimeout> | null = null;
	#pass: Promise<void> | null = null;
	#again = false;
	#stopped = false;

	constructor(context: MainContext, log: (line: string) => void) {
		this.#context = context;
		this.#log = log;
	}

	start(): void {
		const { events, commands } = this.#context;
		this.#unsubscribes.push(
			events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (envelope) => this.#onAgentEvent(envelope)),
			commands.observe((outcome) => this.#onCommand(outcome)),
		);
		this.#background(this.#recover());
	}

	dispose(): void {
		this.#stopped = true;
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
		if (this.#safety) clearTimeout(this.#safety);
		this.#safety = null;
	}

	enqueue(jobRun: JobRunRecord, context: string | null): JobRunRecord {
		insertJobRun(this.#context.db, jobRun, context);
		this.#emit(jobRun, null);
		if (jobRun.status === 'queued') this.kick();
		return jobRun;
	}

	fold(jobRun: JobRunRecord, context: string | null, promote: boolean): JobRunRecord | null {
		const { db } = this.#context;
		const folded = this.#update(jobRun.id, (current) =>
			current.status === 'waiting' || current.status === 'queued'
				? {
						...current,
						requests: current.requests + 1,
						...(promote && current.status === 'waiting'
							? { status: 'queued' as const, detail: null }
							: {}),
					}
				: null,
		);
		if (folded) {
			const merged = foldedJobContext(getJobRunContext(db, folded.id), context);
			if (merged !== null) appendJobRunContext(db, folded.id, merged);
		}
		return folded;
	}

	confirm(jobRun: JobRunRecord): JobRunRecord {
		return (
			this.#update(jobRun.id, (current) =>
				current.status === 'waiting' ? { ...current, status: 'queued' } : null,
			) ??
			getJobRun(this.#context.db, jobRun.id) ??
			jobRun
		);
	}

	async cancel(jobRun: JobRunRecord, detail: string | null = null): Promise<JobRunRecord> {
		if (isActive(jobRun.status) && jobRun.sessionId !== null) {
			await this.#stopAgentRun(jobRun.id, jobRun.sessionId, jobRun.agentRunId);
		}
		return (
			this.#finish(jobRun.id, 'cancelled', detail) ??
			getJobRun(this.#context.db, jobRun.id) ??
			jobRun
		);
	}

	async close(workstreamId: string): Promise<void> {
		for (const jobRun of listUnfinishedJobRuns(this.#context.db)) {
			if (jobRun.workstreamId === workstreamId) await this.cancel(jobRun, WORKSTREAM_CLOSED);
		}
	}

	kick(): void {
		if (this.#stopped) return;
		this.#again = true;
		if (this.#pass) return;
		this.#pass = this.#schedule()
			.catch((error: unknown) => {
				this.#again = false;
				this.#log(`jobs: scheduling failed: ${describeError(error)}`);
			})
			.finally(() => {
				this.#pass = null;
				if (this.#again) this.kick();
			});
	}

	async #schedule(): Promise<void> {
		while (this.#again && !this.#stopped) {
			this.#again = false;
			await this.#dispatchReady();
		}
		this.#armSafety();
	}

	async #dispatchReady(): Promise<void> {
		const cap = await this.#maxConcurrent();
		const unfinished = listUnfinishedJobRuns(this.#context.db);
		let running = unfinished.filter((jobRun) => jobRun.status === 'running').length;
		const blocked = new Set(
			unfinished.flatMap((jobRun) =>
				isActive(jobRun.status) && jobRun.workstreamId !== null ? [jobRun.workstreamId] : [],
			),
		);
		const resolver = getBuiltinJobDefinition(this.#context.db, 'resolve-conflicts')?.id ?? null;
		const queuedRuns = unfinished.filter((jobRun) => jobRun.status === 'queued');
		const resolversFirst = [
			...queuedRuns.filter((jobRun) => jobRun.definitionId === resolver),
			...queuedRuns.filter((jobRun) => jobRun.definitionId !== resolver),
		];
		for (const queued of resolversFirst) {
			if (this.#stopped || running >= cap) return;
			const { workstreamId } = queued;
			if (this.#awaitsItsJob(queued)) continue;
			if (workstreamId !== null && blocked.has(workstreamId)) continue;
			if (workstreamId !== null) blocked.add(workstreamId);
			if ((this.#retryAt.get(queued.id) ?? 0) > Date.now()) continue;
			if (workstreamId !== null && (await this.#agentWorking(workstreamId))) continue;
			const started = this.#update(queued.id, (current) =>
				current.status === 'queued' && !this.#stopped
					? { ...current, status: 'running', detail: null, startedAt: nowIso8601() }
					: null,
			);
			if (!started) continue;
			running += 1;
			this.#retryAt.delete(started.id);
			this.#background(this.#dispatch(started));
		}
	}

	async #maxConcurrent(): Promise<number> {
		try {
			const settings = await this.#context.commands.call('app.list-settings', undefined);
			return jobsMaxConcurrent(settings[JOBS_MAX_CONCURRENT_SETTING]);
		} catch (error) {
			this.#log(`jobs: could not read the concurrency setting: ${describeError(error)}`);
			return jobsMaxConcurrent(null);
		}
	}

	async #agentWorking(workstreamId: string): Promise<boolean> {
		try {
			return await this.#context.commands.call('chat.workstream-has-working-run', { workstreamId });
		} catch (error) {
			this.#log(
				`jobs: could not check \`${workstreamId}\` for working runs: ${describeError(error)}`,
			);
			return true;
		}
	}

	async #dispatch(jobRun: JobRunRecord): Promise<void> {
		const { db, commands } = this.#context;
		try {
			const definition = getJobDefinition(db, jobRun.definitionId);
			if (!definition) throw new Error('This job no longer exists.');
			if (isAgentlessJobBuiltin(definition.builtin)) {
				if (jobRun.workstreamId === null) throw new Error(`${definition.name} needs a workstream.`);
				await this.#runAgentless(jobRun, definition.builtin, jobRun.workstreamId);
				return;
			}
			const workstreamId = jobRun.workstreamId ?? (await this.#createWorkstream(jobRun));
			if (!this.#dispatching(jobRun.id)) return;
			const runContext = getJobRunContext(db, jobRun.id);
			const conflicts =
				definition.builtin === 'resolve-conflicts'
					? await this.#conflicts(jobRun.id, workstreamId)
					: null;
			if (!this.#dispatching(jobRun.id)) return;
			const sessionId =
				jobRun.sessionId ??
				(await commands.call('chat.start-session', {
					workstreamId,
					provider: definition.provider,
					model: definition.model,
					origin: 'job',
					displayName: jobRun.title,
				}));
			if (definition.skills.length > 0) chooseSessionSkills(db, sessionId, definition.skills);
			const withSession = this.#update(jobRun.id, (current) =>
				current.status === 'running' && !this.#stopped ? { ...current, sessionId } : null,
			);
			if (!withSession) return;
			// ponytail: jobs run in auto mode like the user's chats; sandbox them once the sandbox can run gh, e2e and scratch worktrees without asking
			const agentRunId = await commands.call('chat.send-prompt', {
				sessionId,
				prompt: jobPrompt(
					jobPrompt(definition.instructions, runContext),
					conflicts === runContext ? null : conflicts,
				),
				profile: { effort: definition.effort, mode: 'agent', access: 'auto' },
				automated: true,
				chainId: jobRun.chainId,
			});
			this.#update(jobRun.id, (current) =>
				isActive(current.status) && current.agentRunId !== agentRunId
					? { ...current, agentRunId }
					: null,
			);
			if (getJobRun(db, jobRun.id)?.status === 'cancelled') {
				await this.#stopAgentRun(jobRun.id, sessionId, agentRunId);
			}
		} catch (error) {
			if (workstreamWasBusy(error) && this.#requeue(jobRun.id)) return;
			this.#finish(jobRun.id, 'failed', `Could not start the job: ${describeError(error)}`);
		}
	}

	async #runAgentless(
		jobRun: JobRunRecord,
		builtin: AgentlessJobBuiltin,
		workstreamId: string,
	): Promise<void> {
		if (builtin === 'update-from-main') {
			await this.#updateFromMain(jobRun, workstreamId);
			return;
		}
		const { command, opening, pushing } = SHIPPING[builtin];
		try {
			const { pullRequestUrl } = await this.#context.commands.call(command, { workstreamId });
			this.#succeed(jobRun.id, pullRequestUrl ? `${pushing} ${pullRequestUrl}` : opening);
		} catch (error) {
			this.#finish(jobRun.id, 'failed', describeError(error));
		}
	}

	async #updateFromMain(jobRun: JobRunRecord, workstreamId: string): Promise<void> {
		const workstream = this.#workstream(workstreamId);
		const baseBranch = await this.#baseBranch(workstream);
		if (!baseBranch) throw new Error('This workstream has no base branch to update from.');
		const status = await this.#context.commands.call('repositories.workstream-status', {
			workstreamId,
		});
		const stopped = hasConflictedMerge(status);
		const conflicted = stopped
			? status
			: await this.#mergeBase(jobRun.id, status, workstreamId, baseBranch);
		if (conflicted === null || !this.#dispatching(jobRun.id)) return;
		const files = conflicted.conflictedPaths.length;
		const where = `${files} ${files === 1 ? 'file' : 'files'}`;
		this.#succeed(
			jobRun.id,
			stopped
				? `A merge had already stopped on conflicts in ${where}.`
				: `Stopped on conflicts in ${where}.`,
		);
	}

	async #conflicts(jobRunId: string, workstreamId: string): Promise<string | null> {
		const workstream = this.#workstream(workstreamId);
		const status = await this.#context.commands.call('repositories.workstream-status', {
			workstreamId,
		});
		if (!hasConflictedMerge(status) && status.conflictMarkerPaths.length === 0) {
			this.#succeed(jobRunId, 'No conflicts to resolve.');
			return null;
		}
		return updateFromMainJobContext({
			branch: workstream.branch,
			baseBranch: (await this.#baseBranch(workstream)) ?? '',
			conflictedPaths: [...new Set([...status.conflictedPaths, ...status.conflictMarkerPaths])],
			conflictMarkerPaths: status.conflictMarkerPaths,
		});
	}

	#workstream(workstreamId: string): Workstream {
		const workstream = getWorkstream(this.#context.db, workstreamId);
		if (!workstream) throw new Error('The workstream for this job no longer exists.');
		return workstream;
	}

	async #baseBranch(workstream: Workstream): Promise<string | null> {
		return (
			workstream.baseBranch ||
			(await resolveConnectedRepository(this.#context.db, workstream.projectId))?.defaultBranch ||
			null
		);
	}

	async #mergeBase(
		jobRunId: string,
		status: WorktreeStatus,
		workstreamId: string,
		baseBranch: string,
	): Promise<WorktreeStatus | null> {
		const { commands } = this.#context;
		const blocker = updateBlocker(status);
		if (blocker !== null) {
			this.#finish(jobRunId, 'failed', blocker);
			return null;
		}
		const args = { workstreamId, baseBranch };
		const behind = await commands.call('repositories.count-behind-base', args);
		if (!this.#dispatching(jobRunId)) return null;
		if (behind === 0) {
			this.#succeed(jobRunId, `Already up to date with ${baseBranch}`);
			return null;
		}
		await commands.call('repositories.pull-workstream', args);
		const merged = await commands.call('repositories.workstream-status', { workstreamId });
		if (merged.operationInProgress === 'merge') return merged;
		this.#succeed(
			jobRunId,
			`Merged ${behind} ${behind === 1 ? 'commit' : 'commits'} from ${baseBranch}`,
		);
		return null;
	}

	#dispatching(jobRunId: string): boolean {
		return !this.#stopped && getJobRun(this.#context.db, jobRunId)?.status === 'running';
	}

	async #createWorkstream(jobRun: JobRunRecord): Promise<string> {
		const { db, commands } = this.#context;
		if (jobRun.scope !== null) {
			const lead = await commands.call('repositories.create-lead', {
				scope: jobRun.scope,
				workstreamId: nextWorkstreamId(),
				name: jobRun.title,
			});
			this.#update(jobRun.id, (current) => ({ ...current, workstreamId: lead.id }));
			return lead.id;
		}
		const planned =
			jobRun.repositoryId === null ? null : await planRepositoryWorkstream(db, jobRun.repositoryId);
		if (!planned) throw new Error('The repository for this job is no longer connected.');
		const plan = jobRun.origin === 'schedule' ? { ...planned, name: jobRun.title } : planned;
		await createPlannedWorkstream(commands, plan, await clonePlannedRepository(commands, plan));
		const { workstreamId } = plan;
		this.#update(jobRun.id, (current) => ({ ...current, workstreamId }));
		if (!this.#dispatching(jobRun.id)) return workstreamId;
		await prepareStartedWorkstream(this.#context, workstreamId, (line) =>
			this.#log(`jobs: ${line}`),
		);
		return workstreamId;
	}

	#requeue(jobRunId: string): boolean {
		const requeued = this.#update(jobRunId, (current) =>
			current.status === 'running' ? { ...current, status: 'queued', startedAt: null } : null,
		);
		if (!requeued) return false;
		this.#retryAt.set(jobRunId, Date.now() + BUSY_RETRY_MS);
		this.#later(BUSY_RETRY_MS);
		return true;
	}

	async #stopAgentRun(
		jobRunId: string,
		sessionId: string,
		agentRunId: string | null,
	): Promise<void> {
		try {
			await this.#context.commands.call('chat.cancel-run', {
				sessionId,
				pendingRunId: agentRunId,
			});
		} catch (error) {
			if (agentRunWasAlreadyGone(error)) return;
			this.#log(`jobs: could not stop the agent run of \`${jobRunId}\`: ${describeError(error)}`);
		}
	}

	#onAgentEvent(envelope: AgentEventEnvelope): void {
		try {
			const type = envelope.event['type'];
			if (typeof type === 'string' && resumesTurn({ type })) this.#wentOn(envelope.runId);
			if (type === 'run.started') this.#resumed(envelope.sessionId, envelope.runId);
			else if (type === 'approval.requested') this.#waiting(envelope, 'approvalId');
			else if (type === 'question.requested') this.#waiting(envelope, 'questionId');
			else if (type === 'run.completed' || type === 'run.failed') {
				this.#waitingRuns.delete(envelope.runId);
				this.#ended(envelope);
				this.kick();
			} else if (turnEndedOverBackgroundCommands(envelope.event)) {
				this.#endedOverBackgroundCommands(envelope);
				this.kick();
			}
		} catch (error) {
			this.#log(`jobs: could not track an agent event: ${describeError(error)}`);
		}
	}

	#resumed(sessionId: string, agentRunId: string): void {
		const jobRun = findActiveJobRunForSession(this.#context.db, sessionId);
		if (!jobRun) return;
		this.#pendingRequests.delete(sessionId);
		this.#update(jobRun.id, (current) =>
			current.status === 'needs-you' || current.agentRunId !== agentRunId
				? { ...current, status: 'running', agentRunId }
				: null,
		);
	}

	#waiting(envelope: AgentEventEnvelope, requestKey: 'approvalId' | 'questionId'): void {
		const jobRun = findActiveJobRunForSession(this.#context.db, envelope.sessionId);
		if (!jobRun) return;
		const requestId = text(envelope.event[requestKey]);
		if (requestId !== null) {
			const pending = this.#pendingRequests.get(envelope.sessionId) ?? new Set<string>();
			pending.add(requestId);
			this.#pendingRequests.set(envelope.sessionId, pending);
		}
		this.#update(jobRun.id, (current) =>
			current.status === 'running' ? { ...current, status: 'needs-you' } : null,
		);
	}

	#ended(envelope: AgentEventEnvelope): void {
		const jobRun = findActiveJobRunForSession(this.#context.db, envelope.sessionId);
		if (!jobRun) return;
		if (envelope.event['type'] === 'run.completed') {
			this.#pendingRequests.delete(envelope.sessionId);
			this.#succeed(jobRun.id, text(envelope.event['summary']));
			return;
		}
		const error = text(envelope.event['error']) ?? 'The agent run failed.';
		if (error === PAUSED_FOR_EXIT_ERROR || isPausedRunEvent(envelope.event)) return;
		this.#pendingRequests.delete(envelope.sessionId);
		if (isCancellationError(error)) this.#finish(jobRun.id, 'cancelled', null);
		else this.#finish(jobRun.id, 'failed', error);
	}

	#endedOverBackgroundCommands(envelope: AgentEventEnvelope): void {
		const summary = text(envelope.event['summary']);
		if (summary === null) return;
		const jobRun = findActiveJobRunForSession(this.#context.db, envelope.sessionId);
		if (!jobRun) return;
		this.#pendingRequests.delete(envelope.sessionId);
		this.#waitingRuns.set(envelope.runId, jobRun.id);
		this.#succeed(jobRun.id, summary);
	}

	#wentOn(agentRunId: string): void {
		const jobRunId = this.#waitingRuns.get(agentRunId);
		if (jobRunId === undefined) return;
		this.#waitingRuns.delete(agentRunId);
		this.#update(jobRunId, (current) =>
			current.status === 'succeeded' && current.agentRunId === agentRunId
				? { ...current, status: 'running', detail: null, finishedAt: null }
				: null,
		);
	}

	#awaitsItsJob({ parentRunId }: JobRunRecord): boolean {
		const job = parentRunId === null ? null : getJobRun(this.#context.db, parentRunId);
		if (!job?.agentRunId || this.#waitingRuns.get(job.agentRunId) !== job.id) return false;
		return !hasTurnReport(job.detail ?? '');
	}

	#onCommand(outcome: CommandOutcome): void {
		if (!outcome.ok) return;
		const requestKey =
			outcome.command === 'chat.decide-approval'
				? 'approvalId'
				: outcome.command === 'chat.answer-question'
					? 'questionId'
					: null;
		const sessionId = requestKey === null ? null : stringField(outcome.args, 'sessionId');
		if (requestKey === null || sessionId === null) return;
		const pending = this.#pendingRequests.get(sessionId);
		const requestId = stringField(outcome.args, requestKey);
		if (pending && requestId !== null) pending.delete(requestId);
		if (pending && pending.size > 0) return;
		this.#pendingRequests.delete(sessionId);
		const jobRun = findActiveJobRunForSession(this.#context.db, sessionId);
		if (!jobRun) return;
		this.#update(jobRun.id, (current) =>
			current.status === 'needs-you' ? { ...current, status: 'running' } : null,
		);
	}

	#succeed(jobRunId: string, summary: string | null): void {
		this.#finish(jobRunId, 'succeeded', summary);
	}

	async startThen(event: DispatchedEvent): Promise<void> {
		const { db, commands } = this.#context;
		if (event.channel !== JOBS_RUN_FINISHED_CHANNEL) return;
		const runId = findString(isRecord(event.payload) ? event.payload['run'] : null, 'id');
		const jobRun = runId === null ? null : getJobRun(db, runId);
		if (!jobRun || jobRun.workstreamId === null) return;
		const thenJobId = getJobDefinition(db, jobRun.definitionId)?.thenJobId ?? null;
		if (thenJobId === null || triggeredBefore(db, thenJobId, event.id)) return;
		const started = childJobRun(db, jobRun.id, thenJobId);
		if (started) {
			this.#followAgain(started, jobRun);
			return;
		}
		if (jobRun.status !== 'succeeded') return;
		try {
			await commands.call('jobs.run', {
				definitionId: thenJobId,
				workstreamId: jobRun.workstreamId,
				origin: 'then',
				parentRunId: jobRun.id,
				context: truncateJobContext(thenContext(jobRun)),
				...(event.id === null ? {} : { causeEventId: event.id }),
			});
		} catch (error) {
			const next = getJobDefinition(db, thenJobId)?.name ?? 'the next job';
			const failure = `Could not start ${next}: ${describeError(error)}`;
			this.#update(jobRun.id, (current) => ({
				...current,
				detail: current.detail ? `${current.detail}\n\n${failure}` : failure,
			}));
		}
	}

	#followAgain(then: JobRunRecord, job: JobRunRecord): void {
		if (then.status !== 'waiting' && then.status !== 'queued') return;
		if (job.status === 'succeeded') {
			appendJobRunContext(this.#context.db, then.id, truncateJobContext(thenContext(job)));
		} else {
			this.#finish(then.id, 'cancelled', `${job.title} went on and did not succeed.`);
		}
	}

	async #recover(): Promise<void> {
		const { db } = this.#context;
		for (const jobRun of listUnfinishedJobRuns(db)) {
			if (this.#stopped) return;
			const closed = jobRun.workstreamId !== null && isWorkstreamClosed(db, jobRun.workstreamId);
			if (!closed && !isActive(jobRun.status)) continue;
			try {
				if (closed) await this.cancel(jobRun, WORKSTREAM_CLOSED);
				else await this.#recoverRun(jobRun);
			} catch (error) {
				this.#log(`jobs: could not recover \`${jobRun.id}\`: ${describeError(error)}`);
			}
		}
		this.kick();
	}

	async #recoverRun(jobRun: JobRunRecord): Promise<void> {
		const session = jobRun.sessionId === null ? null : await this.#sessionState(jobRun.sessionId);
		if (session?.paused) return;
		if (session === null || session.status === 'idle' || session.status === 'failed') {
			this.#finish(jobRun.id, 'failed', JOB_INTERRUPTED_DETAIL);
			return;
		}
		if (session.status === 'completed') {
			this.#succeed(jobRun.id, session.summary);
			return;
		}
		const status = session.status === 'running' ? 'running' : 'needs-you';
		const agentRunId = session.runId ?? jobRun.agentRunId;
		this.#update(jobRun.id, (current) =>
			current.status === jobRun.status &&
			(current.status !== status || current.agentRunId !== agentRunId)
				? { ...current, status, agentRunId }
				: null,
		);
	}

	async #sessionState(sessionId: string): Promise<SessionState> {
		const envelopes = await this.#context.commands.call('chat.list-events', {
			sessionId,
			afterSeq: 0,
		});
		const fold = foldSessionStatus('idle', envelopes.flatMap(lifecycleEnvelope));
		const completed = envelopes
			.filter((envelope) => envelope.event['type'] === 'run.completed')
			.at(-1);
		const ended = envelopes
			.filter(({ event }) => event['type'] === 'run.completed' || event['type'] === 'run.failed')
			.at(-1);
		return {
			status: fold.status,
			runId: fold.currentRunId,
			summary: text(completed?.event['summary']),
			paused: fold.status === 'idle' && ended !== undefined && isPausedRunEvent(ended.event),
		};
	}

	#finish(
		jobRunId: string,
		status: Extract<JobRunStatus, 'succeeded' | 'failed' | 'cancelled'>,
		detail: string | null,
	): JobRunRecord | null {
		const finished = this.#update(jobRunId, (current) =>
			isFinishedJobRunStatus(current.status)
				? null
				: { ...current, status, detail, finishedAt: nowIso8601() },
		);
		if (finished) this.#retryAt.delete(jobRunId);
		return finished;
	}

	#update(
		jobRunId: string,
		change: (current: JobRunRecord) => JobRunRecord | null,
	): JobRunRecord | null {
		const current = getJobRun(this.#context.db, jobRunId);
		const next = current ? change(current) : null;
		if (!current || !next) return null;
		saveJobRun(this.#context.db, next);
		this.#emit(next, current.status);
		this.kick();
		return next;
	}

	#emit(jobRun: JobRunRecord, was: JobRunStatus | null): void {
		const { events } = this.#context;
		const payload: JobRunChangedEvent = { run: jobRun };
		events.emit(JOBS_RUN_CHANGED_CHANNEL, payload);
		if (jobRun.status === 'running' && was === 'queued') {
			events.emit(JOBS_RUN_STARTED_CHANNEL, payload);
		}
		if (isFinishedJobRunStatus(jobRun.status) && was !== null && !isFinishedJobRunStatus(was)) {
			events.emit(JOBS_RUN_FINISHED_CHANNEL, payload);
		}
	}

	#armSafety(): void {
		if (this.#safety) clearTimeout(this.#safety);
		this.#safety = null;
		if (this.#stopped) return;
		const queued = listUnfinishedJobRuns(this.#context.db).some(
			(jobRun) => jobRun.status === 'queued',
		);
		if (!queued) return;
		this.#safety = setTimeout(() => {
			this.#safety = null;
			this.kick();
		}, SAFETY_INTERVAL_MS);
	}

	#later(delayMs: number): void {
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			this.kick();
		}, delayMs);
		this.#timers.add(timer);
	}

	#background(work: Promise<void>): void {
		void work.catch((error: unknown) => this.#log(`jobs: ${describeError(error)}`));
	}
}

function thenContext({ title, detail }: JobRunRecord): string {
	return detail
		? `This job runs after “${title}”, which finished with:\n\n${detail}`
		: `This job runs after “${title}”.`;
}

function hasConflictedMerge(status: WorktreeStatus): boolean {
	return status.operationInProgress === 'merge' && status.conflictedPaths.length > 0;
}

function updateBlocker(status: WorktreeStatus): string | null {
	if (status.operationInProgress !== null) {
		return `A ${status.operationInProgress} is in progress in this workstream. Finish or abort it first.`;
	}
	if (status.dirtyPaths.length > 0) {
		return 'Commit or discard the uncommitted changes, then update from main again.';
	}
	return null;
}

function isActive(status: JobRunStatus): boolean {
	return status === 'running' || status === 'needs-you';
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringField(value: unknown, key: string): string | null {
	return isRecord(value) ? text(value[key]) : null;
}

function lifecycleEnvelope(envelope: AgentEventEnvelope): LifecycleEnvelope[] {
	const type = envelope.event['type'] === 'user.message' ? 'run.started' : envelope.event['type'];
	return typeof type === 'string'
		? [
				{
					runId: envelope.runId,
					event: { type, error: envelope.event['error'], resumeAt: envelope.event['resumeAt'] },
				},
			]
		: [];
}
