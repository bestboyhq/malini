import { randomUUID } from 'node:crypto';
import {
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_DECISION_CHANGED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
} from '$contract/events';
import {
	JOB_INTERRUPTED_DETAIL,
	JOBS_RECONCILER_SETTING,
	isAgentlessJobBuiltin,
	isAutomaticJobBuiltin,
	reconcilerMode,
	type JobRunRecord,
	type ReconcilerCandidate,
	type ReconcilerDecisionRecord,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	getSession,
	latestSessionForWorkstream,
	latestSessionReport,
	latestWorkstreamTurn,
	sessionHasWorkingRun,
	userSessionWorkstreamId,
	workChatTurnInWorkstream,
} from '$lib/chat/chat.platform';
import { getWorkstream, listWorkstreams } from '$shared/repositories/repositories.platform';
import { isRunnableJob } from '../domain/builtin-jobs';
import { workstreamWasBusy } from '../domain/job-run';
import {
	outputPick,
	pickOutput,
	reconcilerPrompt,
	reconcilerQuestion,
	validatePick,
	wakePrompt,
	wakesInChain,
	type ReconcilerChat,
	type ReconcilerSituation,
} from '../domain/reconciler';
import { startingSessionId } from './agent-actions.repository';
import { runAutomaticJob, type ChooseWithJob } from './automatic-jobs.service';
import { findString, type DispatchedEvent } from './event-log.service';
import { getBuiltinJobDefinition, getJobDefinition } from './job-definitions.repository';
import {
	countChainJobRuns,
	findPendingJobRun,
	getJobRun,
	getJobRunContext,
} from './job-runs.repository';
import {
	decidedEvent,
	getDecision,
	insertDecision,
	listChainDecisions,
	listPendingDecisions,
	saveDecision,
} from './reconciler-decisions.repository';

export class ReconcilerError extends Error {
	readonly kind: 'not-found' | 'invalid-args' | 'decided';

	constructor(kind: ReconcilerError['kind'], message: string) {
		super(message);
		this.name = 'ReconcilerError';
		this.kind = kind;
	}
}

const HANDLED_CONFLICT_BUILTINS = new Set(['update-from-main', 'resolve-conflicts']);

const WAKE_RETRY_MS = 3_000;

const WAKE_RETRIES = 20;

type QueuedEvent = Readonly<{ event: DispatchedEvent; done: () => void }>;

export type ReconcilerRules = Readonly<{
	triggers: (event: DispatchedEvent) => Promise<boolean>;
	thens: (event: DispatchedEvent) => Promise<void>;
}>;

export class Reconciler {
	readonly #context: MainContext;
	readonly #log: (line: string) => void;
	readonly #choose: ChooseWithJob;
	readonly #rules: ReconcilerRules;
	readonly #queue = new Map<string, QueuedEvent>();
	readonly #flushing = new Set<string>();
	readonly #wakeRetries = new Map<string, number>();
	readonly #timers = new Set<NodeJS.Timeout>();
	#working: Promise<void> | null = null;
	#unsubscribe: (() => void) | null = null;
	#stopped = false;

	constructor(
		context: MainContext,
		log: (line: string) => void,
		choose: ChooseWithJob,
		rules: ReconcilerRules,
	) {
		this.#context = context;
		this.#log = log;
		this.#choose = choose;
		this.#rules = rules;
	}

	start(): void {
		this.#unsubscribe = this.#context.events.subscribe(
			CHAT_TURN_FINISHED_CHANNEL,
			({ sessionId }) => this.#background(this.#flushWakes(sessionId)),
		);
		const sessions = new Set<string>();
		for (const decision of listPendingDecisions(this.#context.db)) {
			const chosen = decision.candidates[decision.chosen];
			if (chosen?.kind === 'wake-chat') {
				sessions.add(chosen.sessionId);
				continue;
			}
			this.#save({
				...decision,
				status: 'failed',
				detail: JOB_INTERRUPTED_DETAIL,
				finishedAt: nowIso8601(),
			});
		}
		for (const sessionId of sessions) this.#background(this.#flushWakes(sessionId));
	}

	dispose(): void {
		this.#stopped = true;
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#queue.clear();
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
	}

	async handle(event: DispatchedEvent): Promise<void> {
		const [triggered] = await Promise.all([this.#rules.triggers(event), this.#rules.thens(event)]);
		await this.#consider(event, triggered);
	}

	#consider(event: DispatchedEvent, matched: boolean): Promise<void> {
		const key = matched || event.id === null || this.#stopped ? null : subjectKey(event);
		if (key === null) return Promise.resolve();
		return new Promise((done) => {
			this.#queue.get(key)?.done();
			this.#queue.delete(key);
			this.#queue.set(key, { event, done });
			this.#drain();
		});
	}

	idle(): Promise<void> {
		return this.#working ?? Promise.resolve();
	}

	async decide(decisionId: string, candidate: number): Promise<ReconcilerDecisionRecord> {
		const decision = getDecision(this.#context.db, decisionId);
		if (!decision) throw new ReconcilerError('not-found', `Decision \`${decisionId}\` not found.`);
		if (decision.status !== 'asking') {
			throw new ReconcilerError('decided', 'This was already decided.');
		}
		const picked = decision.candidates[candidate];
		if (!picked || picked.kind === 'ask-you') {
			throw new ReconcilerError(
				'invalid-args',
				'`candidate` must be one of the choices Malini offered.',
			);
		}
		const chosen = this.#save({
			...decision,
			chosen: candidate,
			decidedBy: 'you',
			status: 'pending',
			finishedAt: null,
		});
		return this.#carryOut(chosen);
	}

	#drain(): void {
		if (this.#working) return;
		this.#working = (async () => {
			while (!this.#stopped) {
				const next = this.#queue.entries().next();
				if (next.done) return;
				const [key, { event, done }] = next.value;
				this.#queue.delete(key);
				try {
					await this.#reconcile(event);
				} catch (error) {
					this.#log(
						`jobs: the reconciler could not decide on ${event.channel}: ${describeError(error)}`,
					);
				} finally {
					done();
				}
			}
		})().finally(() => {
			this.#working = null;
			if (this.#queue.size > 0 && !this.#stopped) this.#drain();
		});
	}

	async #reconcile(event: DispatchedEvent): Promise<void> {
		const { db } = this.#context;
		if (event.id === null || event.chainId === null) return;
		if (!(await this.#enabled()) || decidedEvent(db, event.id)) return;
		const situation = this.#situation(event, event.chainId);
		const question = situation === null ? null : reconcilerQuestion(situation);
		if (question === null) return;
		const prompt = reconcilerPrompt(question);
		const labels = question.candidates.map((candidate) => candidate.label);
		const base = {
			id: randomUUID(),
			eventId: event.id,
			channel: event.channel,
			chainId: event.chainId,
			workstreamId: findString(event.payload, 'workstreamId'),
			facts: question.facts,
			jobRunId: null,
			createdAt: nowIso8601(),
		};
		let pick: number;
		try {
			const output = await runAutomaticJob(db, 'reconcile', prompt, async (task, job) =>
				pickOutput(labels, await this.#choose(task, job, labels.length)),
			);
			pick = (outputPick(output) ?? 1) - 1;
		} catch (error) {
			const failed: ReconcilerDecisionRecord = {
				...base,
				candidates: question.candidates,
				pick: null,
				chosen: 0,
				decidedBy: 'rules',
				status: 'failed',
				detail: `Malini could not ask the model: ${describeError(error)}`,
				finishedAt: nowIso8601(),
			};
			insertDecision(db, failed);
			this.#emit(failed);
			return;
		}
		const chainDecisions = listChainDecisions(db, event.chainId);
		const validated = validatePick(question.candidates, pick, (sessionId) =>
			wakesInChain(chainDecisions, sessionId, base.workstreamId),
		);
		const decision: ReconcilerDecisionRecord = {
			...base,
			candidates: validated.candidates,
			pick,
			chosen: validated.chosen,
			decidedBy: validated.decidedBy,
			status: 'pending',
			detail: validated.detail,
			finishedAt: null,
		};
		insertDecision(db, decision);
		await this.#carryOut(decision);
	}

	async #carryOut(decision: ReconcilerDecisionRecord): Promise<ReconcilerDecisionRecord> {
		const candidate = decision.candidates[decision.chosen];
		if (!candidate || candidate.kind === 'nothing') {
			return this.#save({
				...decision,
				status: decision.decidedBy === 'you' ? 'dismissed' : 'done',
				finishedAt: nowIso8601(),
			});
		}
		if (candidate.kind === 'ask-you') {
			const asking = this.#save({ ...decision, status: 'asking', finishedAt: null });
			this.#background(this.#notify(asking, candidate.reason));
			return asking;
		}
		if (candidate.kind === 'run-job') return this.#runJob(decision, candidate);
		const pending = this.#save({ ...decision, status: 'pending', finishedAt: null });
		await this.#flushWakes(candidate.sessionId);
		return getDecision(this.#context.db, decision.id) ?? pending;
	}

	async #runJob(
		decision: ReconcilerDecisionRecord,
		candidate: Extract<ReconcilerCandidate, { kind: 'run-job' }>,
	): Promise<ReconcilerDecisionRecord> {
		const definition = getJobDefinition(this.#context.db, candidate.definitionId);
		try {
			if (!definition) throw new Error('That job no longer exists.');
			const run = await this.#context.commands.call('jobs.run', {
				definitionId: definition.id,
				workstreamId: candidate.workstreamId,
				origin: 'reconciler',
				context: candidate.context,
				causeEventId: decision.eventId,
				waitForYou:
					decision.decidedBy !== 'you' &&
					definition.builtin === null &&
					definition.trigger?.mode !== 'auto',
			});
			return this.#save({
				...decision,
				status: 'done',
				jobRunId: run.id,
				finishedAt: nowIso8601(),
			});
		} catch (error) {
			return this.#save({
				...decision,
				status: 'failed',
				detail: `Could not run ${definition?.name ?? 'the job'}: ${describeError(error)}`,
				finishedAt: nowIso8601(),
			});
		}
	}

	async #flushWakes(sessionId: string): Promise<void> {
		const { db, commands } = this.#context;
		if (this.#flushing.has(sessionId) || this.#stopped) return;
		this.#flushing.add(sessionId);
		try {
			const waiting = listPendingDecisions(db).flatMap((decision) => {
				const chosen = decision.candidates[decision.chosen];
				return chosen?.kind === 'wake-chat' && chosen.sessionId === sessionId
					? [{ decision, wake: chosen }]
					: [];
			});
			const first = waiting[0];
			if (!first) return;
			const session = getSession(db, sessionId);
			if (!session || session.archivedAt !== null) {
				for (const { decision } of waiting) {
					this.#save({
						...decision,
						status: 'failed',
						detail: 'That chat is gone.',
						finishedAt: nowIso8601(),
					});
				}
				return;
			}
			if (sessionHasWorkingRun(db, sessionId)) return;
			const from = waiting.find(({ wake }) => wake.from !== wake.workstreamId)?.wake.from;
			try {
				await commands.call('chat.send-prompt', {
					sessionId,
					prompt: wakePrompt(waiting.map(({ wake }) => wake.report)),
					automated: true,
					chainId: first.decision.chainId,
					causeEventId: first.decision.eventId,
					...(from === undefined ? {} : { from }),
				});
			} catch (error) {
				if (workstreamWasBusy(error) && this.#retryWakes(sessionId)) return;
				for (const { decision } of waiting) {
					this.#save({
						...decision,
						status: 'failed',
						detail: `Malini could not wake the chat: ${describeError(error)}`,
						finishedAt: nowIso8601(),
					});
				}
				return;
			}
			this.#wakeRetries.delete(sessionId);
			for (const { decision } of waiting) {
				this.#save({ ...decision, status: 'done', finishedAt: nowIso8601() });
			}
		} finally {
			this.#flushing.delete(sessionId);
		}
	}

	#retryWakes(sessionId: string): boolean {
		const tries = (this.#wakeRetries.get(sessionId) ?? 0) + 1;
		if (tries > WAKE_RETRIES) {
			this.#wakeRetries.delete(sessionId);
			return false;
		}
		this.#wakeRetries.set(sessionId, tries);
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			this.#background(this.#flushWakes(sessionId));
		}, WAKE_RETRY_MS);
		timer.unref();
		this.#timers.add(timer);
		return true;
	}

	#situation(event: DispatchedEvent, chainId: string): ReconcilerSituation | null {
		switch (event.channel) {
			case CHAT_TURN_FINISHED_CHANNEL:
				return this.#turnSituation(event.payload, chainId);
			case JOBS_RUN_FINISHED_CHANNEL:
				return this.#jobRunSituation(event.payload, chainId);
			case REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL:
				return this.#conflictSituation(event, chainId);
			default:
				return null;
		}
	}

	#turnSituation(payload: unknown, chainId: string): ReconcilerSituation | null {
		const { db } = this.#context;
		const workstreamId = findString(payload, 'workstreamId');
		const sessionId = findString(payload, 'sessionId');
		const status = isRecord(payload) ? payload['status'] : null;
		if (workstreamId === null || sessionId === null) return null;
		if (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') return null;
		const workstream = getWorkstream(db, workstreamId);
		if (!workstream?.startedBy) return null;
		const starter = this.#chat(
			startingSessionId(db, workstreamId) ??
				latestSessionForWorkstream(db, workstream.startedBy)?.id ??
				null,
		);
		if (starter === null || starter.workstreamId === workstreamId) return null;
		const siblings = listWorkstreams(db).filter(
			(other) => other.startedBy === starter.workstreamId && other.scope === null,
		);
		const now = nowIso8601();
		return {
			kind: 'turn-finished',
			workstreamId,
			workstreamName: workstream.name,
			chatName: getSession(db, sessionId)?.displayName ?? workstream.name,
			status,
			outcome: findString(payload, 'outcome'),
			needs: findString(payload, 'needs'),
			starter,
			siblings: {
				total: siblings.length,
				working: siblings.filter((other) => workChatTurnInWorkstream(db, other.id, now) !== null)
					.length,
				needYou: siblings.filter((other) => latestWorkstreamTurn(db, other.id)?.need).length,
			},
			wakes: wakesInChain(listChainDecisions(db, chainId), starter.sessionId, workstreamId),
		};
	}

	#jobRunSituation(payload: unknown, chainId: string): ReconcilerSituation | null {
		const { db } = this.#context;
		const runId = findString(isRecord(payload) ? payload['run'] : null, 'id');
		const run = runId === null ? null : getJobRun(db, runId);
		if (!run || (run.status !== 'succeeded' && run.status !== 'failed')) return null;
		if (run.origin === 'merge-queue') return null;
		const definition = getJobDefinition(db, run.definitionId);
		if (!definition || isAutomaticJobBuiltin(definition.builtin)) return null;
		const chat = this.#chat(run.chatSessionId);
		if (run.status === 'succeeded' && chat === null) return null;
		const workstream = run.workstreamId === null ? null : getWorkstream(db, run.workstreamId);
		const retry =
			run.status === 'failed' &&
			run.workstreamId !== null &&
			isRunnableJob(definition) &&
			!isAgentlessJobBuiltin(definition.builtin) &&
			findPendingJobRun(db, definition.id, retryTarget(run)) === null
				? {
						definitionId: definition.id,
						workstreamId: run.workstreamId,
						context:
							getJobRunContext(db, run.id) ?? `Run again after: ${run.detail ?? 'it failed'}`,
					}
				: null;
		return {
			kind: 'job-run',
			title: run.title,
			status: run.status,
			detail: run.detail,
			workstreamId: run.workstreamId,
			workstreamName: workstream?.name ?? null,
			chat,
			retry,
			runsInChain: countChainJobRuns(db, run.chainId, run.definitionId, retryTarget(run)),
			wakes:
				chat === null
					? 0
					: wakesInChain(listChainDecisions(db, chainId), chat.sessionId, run.workstreamId),
		};
	}

	#conflictSituation(event: DispatchedEvent, chainId: string): ReconcilerSituation | null {
		const { db } = this.#context;
		const workstreamId = findString(event.payload, 'workstreamId');
		const workstream = workstreamId === null ? null : getWorkstream(db, workstreamId);
		const paths = isRecord(event.payload) ? event.payload['conflictedPaths'] : null;
		if (!workstream || !Array.isArray(paths)) return null;
		if (event.cause?.kind === 'job-run') {
			const cause = getJobRun(db, event.cause.id);
			const builtin = cause ? getJobDefinition(db, cause.definitionId)?.builtin : null;
			if (cause?.origin === 'merge-queue' || (builtin && HANDLED_CONFLICT_BUILTINS.has(builtin))) {
				return null;
			}
		}
		const resolver = getBuiltinJobDefinition(db, 'resolve-conflicts');
		const resolving =
			resolver !== null &&
			findPendingJobRun(db, resolver.id, {
				workstreamId: workstream.id,
				repositoryId: null,
				scope: null,
			}) !== null;
		const chat = this.#chat(latestSessionForWorkstream(db, workstream.id)?.id ?? null);
		return {
			kind: 'conflict',
			workstreamId: workstream.id,
			workstreamName: workstream.name,
			conflictedPaths: paths.filter((path): path is string => typeof path === 'string'),
			resolverId: resolving ? null : (resolver?.id ?? null),
			chat,
			wakes:
				chat === null
					? 0
					: wakesInChain(listChainDecisions(db, chainId), chat.sessionId, workstream.id),
		};
	}

	#chat(sessionId: string | null): ReconcilerChat | null {
		const { db } = this.#context;
		const session = sessionId === null ? null : getSession(db, sessionId);
		if (!session || session.archivedAt !== null) return null;
		if (userSessionWorkstreamId(db, session.id) === null) return null;
		const workstream = getWorkstream(db, session.workstreamId);
		if (!workstream) return null;
		const latest = latestSessionReport(db, session.id);
		return {
			sessionId: session.id,
			workstreamId: workstream.id,
			chatName: session.displayName,
			workstreamName: workstream.name,
			working: sessionHasWorkingRun(db, session.id),
			lead: workstream.scope !== null,
			lastOutcome: latest?.outcome ?? null,
			lastNeeds: latest?.needs ?? null,
		};
	}

	async #enabled(): Promise<boolean> {
		try {
			const settings = await this.#context.commands.call('app.list-settings', undefined);
			return reconcilerMode(settings[JOBS_RECONCILER_SETTING]) === 'on';
		} catch (error) {
			this.#log(`jobs: could not read the reconciler setting: ${describeError(error)}`);
			return false;
		}
	}

	async #notify(decision: ReconcilerDecisionRecord, reason: string): Promise<void> {
		const { commands, db } = this.#context;
		try {
			if ((await commands.call('app.notification-permission-granted', undefined)) !== true) return;
			const workstreamId = decision.workstreamId;
			const session = workstreamId === null ? null : latestSessionForWorkstream(db, workstreamId);
			await commands.call('app.notify', {
				options: {
					title: 'Malini asks you',
					body: reason,
					...(workstreamId && session ? { opens: { workstreamId, sessionId: session.id } } : {}),
				},
			});
		} catch (error) {
			this.#log(`jobs: could not tell you what the reconciler asks: ${describeError(error)}`);
		}
	}

	#save(decision: ReconcilerDecisionRecord): ReconcilerDecisionRecord {
		saveDecision(this.#context.db, decision);
		this.#emit(decision);
		return decision;
	}

	#emit(decision: ReconcilerDecisionRecord): void {
		this.#context.events.emit(JOBS_DECISION_CHANGED_CHANNEL, { decision });
	}

	#background(work: Promise<void>): void {
		void work.catch((error: unknown) => this.#log(`jobs: ${describeError(error)}`));
	}
}

function subjectKey(event: DispatchedEvent): string | null {
	const { channel, payload } = event;
	if (channel === CHAT_TURN_FINISHED_CHANNEL) {
		const sessionId = findString(payload, 'sessionId');
		return sessionId === null ? null : `turn:${sessionId}`;
	}
	if (channel === JOBS_RUN_FINISHED_CHANNEL) {
		const run = isRecord(payload) ? payload['run'] : null;
		const status = isRecord(run) ? run['status'] : null;
		const origin = isRecord(run) ? run['origin'] : null;
		const id = findString(run, 'id');
		if (id === null || origin === 'merge-queue') return null;
		return status === 'succeeded' || status === 'failed' ? `run:${id}` : null;
	}
	if (channel === REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL) {
		const workstreamId = findString(payload, 'workstreamId');
		return workstreamId === null ? null : `conflict:${workstreamId}`;
	}
	return null;
}

function retryTarget(
	run: JobRunRecord,
): Pick<JobRunRecord, 'workstreamId' | 'repositoryId' | 'scope'> {
	return { workstreamId: run.workstreamId, repositoryId: run.repositoryId, scope: run.scope };
}
