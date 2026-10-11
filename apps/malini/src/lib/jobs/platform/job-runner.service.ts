import type { AgentEventEnvelope } from '$contract/agent';
import {
	PAUSED_FOR_EXIT_ERROR,
	foldSessionStatus,
	isCancellationError,
	type LifecycleEnvelope,
	type SessionStatus,
} from '$contract/agent-state-machine';
import { CHAT_AGENT_EVENT_CHANNEL, JOBS_RUN_CHANGED_CHANNEL } from '$contract/events';
import {
	JOBS_MAX_CONCURRENT_SETTING,
	type JobRunChangedEvent,
	type JobRunRecord,
	type JobRunStatus,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { CommandOutcome } from '$main/ipc/registry';
import {
	listProjects,
	listWorkstreams,
	planWorkstreamProvisioning,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import {
	JOB_INTERRUPTED_DETAIL,
	isFinishedJobRunStatus,
	jobPrompt,
	jobsMaxConcurrent,
	workstreamWasBusy,
} from '../domain/job-run';
import { getJobDefinition } from './job-definitions.repository';
import {
	findActiveJobRunForSession,
	getJobRun,
	getJobRunContext,
	insertJobRun,
	listUnfinishedJobRuns,
	saveJobRun,
} from './job-runs.repository';

const SAFETY_INTERVAL_MS = 15_000;

export const BUSY_RETRY_MS = 3_000;

type SessionState = Readonly<{
	status: SessionStatus;
	runId: string | null;
	summary: string | null;
}>;

export class JobRunner {
	readonly #context: MainContext;
	readonly #log: (line: string) => void;
	readonly #pendingRequests = new Map<string, Set<string>>();
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
		this.#emit(jobRun);
		this.kick();
		return jobRun;
	}

	async cancel(jobRun: JobRunRecord): Promise<JobRunRecord> {
		if (jobRun.status !== 'queued' && jobRun.sessionId !== null) {
			await this.#stopAgentRun(jobRun.id, jobRun.sessionId, jobRun.agentRunId);
		}
		return (
			this.#finish(jobRun.id, 'cancelled', null) ?? getJobRun(this.#context.db, jobRun.id) ?? jobRun
		);
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
				jobRun.status !== 'queued' && jobRun.workstreamId !== null ? [jobRun.workstreamId] : [],
			),
		);
		for (const queued of unfinished.filter((jobRun) => jobRun.status === 'queued')) {
			if (this.#stopped || running >= cap) return;
			const { workstreamId } = queued;
			if (workstreamId !== null && blocked.has(workstreamId)) continue;
			if (workstreamId !== null) blocked.add(workstreamId);
			if ((this.#retryAt.get(queued.id) ?? 0) > Date.now()) continue;
			if (workstreamId !== null && (await this.#userRunOpen(workstreamId))) continue;
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

	async #userRunOpen(workstreamId: string): Promise<boolean> {
		try {
			return await this.#context.commands.call('chat.workstream-has-open-run', { workstreamId });
		} catch (error) {
			this.#log(`jobs: could not check \`${workstreamId}\` for open runs: ${describeError(error)}`);
			return true;
		}
	}

	async #dispatch(jobRun: JobRunRecord): Promise<void> {
		const { db, commands } = this.#context;
		try {
			const definition = getJobDefinition(db, jobRun.definitionId);
			if (!definition) throw new Error('This job no longer exists.');
			const workstreamId = jobRun.workstreamId ?? (await this.#createWorkstream(jobRun));
			if (!this.#dispatching(jobRun.id)) return;
			const sessionId =
				jobRun.sessionId ??
				(await commands.call('chat.start-session', {
					workstreamId,
					model: definition.model,
					origin: 'job',
					displayName: jobRun.title,
				}));
			const withSession = this.#update(jobRun.id, (current) =>
				current.status === 'running' && !this.#stopped ? { ...current, sessionId } : null,
			);
			if (!withSession) return;
			const agentRunId = await commands.call('chat.send-prompt', {
				sessionId,
				prompt: jobPrompt(definition.instructions, getJobRunContext(db, jobRun.id)),
				profile: { effort: definition.effort, mode: 'agent', access: 'sandboxed' },
				automated: true,
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

	#dispatching(jobRunId: string): boolean {
		return !this.#stopped && getJobRun(this.#context.db, jobRunId)?.status === 'running';
	}

	async #createWorkstream(jobRun: JobRunRecord): Promise<string> {
		const { db, commands } = this.#context;
		const repository =
			jobRun.repositoryId === null
				? null
				: await resolveConnectedRepository(db, jobRun.repositoryId);
		if (!repository) throw new Error('The repository for this job is no longer connected.');
		const plan = planWorkstreamProvisioning({
			repo: repository,
			projects: listProjects(db),
			takenNames: listWorkstreams(db).map((workstream) => workstream.name),
		});
		const projectRepoPath =
			plan.projectRepoPath ??
			(await commands.call('repositories.create-repository', { repoUrl: plan.repoUrl }));
		const { workstreamId } = plan;
		await commands.call('repositories.create-workstream', {
			projectRepoPath,
			workstreamId,
			baseBranch: plan.baseBranch,
			projectId: plan.projectId,
			name: plan.name,
		});
		this.#update(jobRun.id, (current) => ({ ...current, workstreamId }));
		if (!this.#dispatching(jobRun.id)) return workstreamId;
		await this.#quietly(
			`update the base branch of \`${workstreamId}\``,
			commands.call('repositories.sync-workstream-base', { workstreamId }),
		);
		await this.#quietly(
			`install dependencies in \`${workstreamId}\``,
			commands.call('repositories.provision-dependencies', { workstreamId }),
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
			this.#log(`jobs: could not stop the agent run of \`${jobRunId}\`: ${describeError(error)}`);
		}
	}

	#onAgentEvent(envelope: AgentEventEnvelope): void {
		try {
			const type = envelope.event['type'];
			if (type === 'run.started') this.#resumed(envelope.sessionId, envelope.runId);
			else if (type === 'approval.requested') this.#waiting(envelope, 'approvalId');
			else if (type === 'question.requested') this.#waiting(envelope, 'questionId');
			else if (type === 'run.completed' || type === 'run.failed') {
				this.#ended(envelope);
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
		if (error === PAUSED_FOR_EXIT_ERROR) return;
		this.#pendingRequests.delete(envelope.sessionId);
		if (isCancellationError(error)) this.#finish(jobRun.id, 'cancelled', null);
		else this.#finish(jobRun.id, 'failed', error);
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
		const succeeded = this.#finish(jobRunId, 'succeeded', summary);
		if (succeeded) this.#background(this.#chainOutput(succeeded));
	}

	async #chainOutput(jobRun: JobRunRecord): Promise<void> {
		const definition = getJobDefinition(this.#context.db, jobRun.definitionId);
		if (!definition || definition.output === 'none' || jobRun.workstreamId === null) return;
		const args = { workstreamId: jobRun.workstreamId };
		try {
			if (definition.output === 'draft') {
				await this.#context.commands.call('pull-requests.open-draft', args);
			} else {
				await this.#context.commands.call('pull-requests.queue-merge', args);
			}
		} catch (error) {
			const action = definition.output === 'draft' ? 'open the draft' : 'queue the merge';
			const failure = `Could not ${action}: ${describeError(error)}`;
			this.#update(jobRun.id, (current) => ({
				...current,
				detail: current.detail ? `${current.detail}\n\n${failure}` : failure,
			}));
		}
	}

	async #recover(): Promise<void> {
		for (const jobRun of listUnfinishedJobRuns(this.#context.db)) {
			if (this.#stopped) return;
			if (jobRun.status === 'queued') continue;
			try {
				await this.#recoverRun(jobRun);
			} catch (error) {
				this.#log(`jobs: could not recover \`${jobRun.id}\`: ${describeError(error)}`);
			}
		}
		this.kick();
	}

	async #recoverRun(jobRun: JobRunRecord): Promise<void> {
		const session = jobRun.sessionId === null ? null : await this.#sessionState(jobRun.sessionId);
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
		return {
			status: fold.status,
			runId: fold.currentRunId,
			summary: text(completed?.event['summary']),
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
		if (!next) return null;
		saveJobRun(this.#context.db, next);
		this.#emit(next);
		this.kick();
		return next;
	}

	#emit(jobRun: JobRunRecord): void {
		const payload: JobRunChangedEvent = { run: jobRun };
		this.#context.events.emit(JOBS_RUN_CHANGED_CHANNEL, payload);
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

	async #quietly(what: string, step: Promise<unknown>): Promise<void> {
		try {
			await step;
		} catch (error) {
			this.#log(`jobs: could not ${what}: ${describeError(error)}`);
		}
	}

	#background(work: Promise<void>): void {
		void work.catch((error: unknown) => this.#log(`jobs: ${describeError(error)}`));
	}
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
		? [{ runId: envelope.runId, event: { type, error: envelope.event['error'] } }]
		: [];
}
