import { randomUUID } from 'node:crypto';
import {
	JOBS_DECISION_CHANGED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
} from '$contract/events';
import {
	JOB_INTERRUPTED_DETAIL,
	isAgentlessJobBuiltin,
	isAutomaticJobBuiltin,
	isShippingJobBuiltin,
	type EventCause,
	type JobRunRecord,
	type ReconcilerCandidate,
	type ReconcilerDecisionRecord,
} from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	getSession,
	latestSessionForWorkstream,
	latestSessionReport,
	sessionHasWorkingRun,
	userSessionWorkstreamId,
} from '$lib/chat/chat.platform';
import {
	getArchivedWorkstream,
	getWorkstream,
	isWorkstreamClosed,
	listWorkstreams,
	workstreamLeads,
} from '$shared/repositories/repositories.platform';
import type { ShippingRule } from '../jobs.platform';
import { isRunnableJob } from '../domain/builtin-jobs';
import {
	RECONCILER_RULES,
	handledSituation,
	outputPick,
	pickOutput,
	reconcilerPrompt,
	reconcilerQuestion,
	ruleHears,
	UNRUN_QUESTION_TITLE,
	validatePick,
	wakesInChain,
	type ChatWake,
	type HandledSituation,
	type ReconcilerChat,
	type ReconcilerQuestion,
	type ReconcilerRule,
	type ReconcilerSituation,
} from '../domain/reconciler';
import { runAutomaticJob, type ChooseWithJob } from './automatic-jobs.service';
import { WORKSTREAM_CLOSED } from './job-runner.service';
import { getLoggedEvent } from './event-log.repository';
import { findString, withHandledEvent, type DispatchedEvent } from './event-log.service';
import { getBuiltinJobDefinition, getJobDefinition } from './job-definitions.repository';
import {
	activeWorkstreamJobRun,
	countChainJobRuns,
	findPendingJobRun,
	getJobRun,
	getJobRunContext,
} from './job-runs.repository';
import {
	decidedEvent,
	getDecision,
	insertDecision,
	listAskingDecisions,
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

const CAUSE_HOPS = 12;

const ASKED_AGAIN = 'Malini asked again.';

type QueuedEvent = Readonly<{ event: DispatchedEvent; done: () => void }>;

type ShippingTurn = { event: DispatchedEvent; done: Promise<void> };

type ShippingQueue = { tail: Promise<void>; next: ShippingTurn | null };

type Rule = Exclude<ReconcilerRule, 'model'>;

const RULES = RECONCILER_RULES.filter((rule): rule is Rule => rule !== 'model');

export type ReconcilerRules = Readonly<
	Record<Exclude<Rule, 'triggers' | 'shipping'>, (event: DispatchedEvent) => Promise<void>> & {
		triggers: (event: DispatchedEvent) => Promise<boolean>;
		shipping: ShippingRule;
	}
>;

export type DeliverWake = (wake: ChatWake) => Promise<void>;

export class Reconciler {
	readonly #context: MainContext;
	readonly #log: (line: string) => void;
	readonly #choose: ChooseWithJob;
	readonly #rules: ReconcilerRules;
	readonly #deliver: DeliverWake;
	readonly #queue = new Map<string, QueuedEvent>();
	readonly #shippingQueues = new Map<string, ShippingQueue>();
	#working: Promise<void> | null = null;
	#stopped = false;

	constructor(
		context: MainContext,
		log: (line: string) => void,
		choose: ChooseWithJob,
		rules: ReconcilerRules,
		deliver: DeliverWake,
	) {
		this.#context = context;
		this.#log = log;
		this.#choose = choose;
		this.#rules = rules;
		this.#deliver = deliver;
	}

	start(): void {
		for (const asking of listAskingDecisions(this.#context.db)) {
			if (this.#closed(asking.workstreamId)) {
				this.#dismiss(asking, WORKSTREAM_CLOSED, this.#closedSince(asking));
			}
		}
		for (const decision of listPendingDecisions(this.#context.db)) {
			const chosen = decision.candidates[decision.chosen];
			if (chosen?.kind === 'wake-chat') {
				this.#background(this.#wake(decision, chosen));
				continue;
			}
			this.#save({
				...decision,
				status: 'failed',
				detail: JOB_INTERRUPTED_DETAIL,
				finishedAt: nowIso8601(),
			});
		}
	}

	dispose(): void {
		this.#stopped = true;
		this.#queue.clear();
	}

	close(workstreamId: string): void {
		for (const asking of listAskingDecisions(this.#context.db)) {
			if (asking.workstreamId === workstreamId) this.#dismiss(asking, WORKSTREAM_CLOSED);
		}
	}

	async handle(event: DispatchedEvent): Promise<void> {
		this.#answerWithRun(event);
		const heard = RULES.filter((rule) => ruleHears(rule, event.channel));
		const matched = heard.includes('triggers') && (await this.#apply('triggers', event)) === true;
		await Promise.all(
			heard.filter((rule) => rule !== 'triggers').map((rule) => this.#apply(rule, event)),
		);
		if (!ruleHears('model', event.channel)) return;
		await this.#consider(event, matched);
	}

	async #apply(rule: Rule, event: DispatchedEvent): Promise<unknown> {
		try {
			if (rule === 'shipping') return await this.#ship(event);
			return await this.#rules[rule](event);
		} catch (error) {
			this.#log(
				`jobs: the ${rule} rule could not handle ${event.channel}: ${describeError(error)}`,
			);
			return false;
		}
	}

	async #ship(event: DispatchedEvent): Promise<void> {
		const workstreamIds = await this.#rules.shipping.hear(event);
		await Promise.all(workstreamIds.map((id) => this.#decideShipping(id, event)));
	}

	#decideShipping(workstreamId: string, event: DispatchedEvent): Promise<void> {
		const queued = this.#shippingQueues.get(workstreamId);
		if (queued?.next) {
			queued.next.event = event;
			return queued.next.done;
		}
		const turn: ShippingTurn = { event, done: Promise.resolve() };
		turn.done = this.#takeTurn(workstreamId, turn, queued?.tail ?? Promise.resolve());
		this.#shippingQueues.set(workstreamId, { tail: turn.done, next: turn });
		void turn.done.finally(() => {
			if (this.#shippingQueues.get(workstreamId)?.tail === turn.done) {
				this.#shippingQueues.delete(workstreamId);
			}
		});
		return turn.done;
	}

	async #takeTurn(
		workstreamId: string,
		turn: ShippingTurn,
		previous: Promise<void>,
	): Promise<void> {
		await previous;
		const current = this.#shippingQueues.get(workstreamId);
		if (current?.next === turn) current.next = null;
		await this.#shipOnce(workstreamId, turn.event);
	}

	async #shipOnce(workstreamId: string, event: DispatchedEvent): Promise<void> {
		if (this.#stopped) return;
		try {
			await withHandledEvent(event, async () => {
				const decision = await this.#rules.shipping.decide(workstreamId);
				await decision?.act(event);
			});
		} catch (error) {
			this.#log(
				`jobs: the shipping rule could not decide for \`${workstreamId}\`: ${describeError(error)}`,
			);
		}
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
					await withHandledEvent(event, () => this.#reconcile(event));
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
		if (event.id === null || event.chainId === null || decidedEvent(db, event.id)) return;
		const situation = this.#situation(event, event.chainId);
		if (situation === null) return;
		const handled = handledSituation(situation);
		if (handled !== null) {
			this.#recordHandled(event, event.id, event.chainId, handled);
			return;
		}
		const question = reconcilerQuestion(situation);
		if (question === null) return;
		const { pick, detail } = await this.#ask(question);
		const workstreamId = findString(event.payload, 'workstreamId');
		const chainDecisions = listChainDecisions(db, event.chainId);
		const validated = validatePick(question.candidates, pick, (sessionId) =>
			wakesInChain(chainDecisions, sessionId, workstreamId),
		);
		const decision: ReconcilerDecisionRecord = {
			id: randomUUID(),
			eventId: event.id,
			channel: event.channel,
			chainId: event.chainId,
			workstreamId,
			facts: question.facts,
			candidates: validated.candidates,
			pick,
			chosen: validated.chosen,
			decidedBy: validated.decidedBy,
			status: 'pending',
			detail: validated.detail ?? detail,
			jobRunId: null,
			subjectRunId: subjectRunId(event),
			createdAt: nowIso8601(),
			finishedAt: null,
		};
		insertDecision(db, decision);
		await this.#carryOut(decision);
	}

	#recordHandled(
		event: DispatchedEvent,
		eventId: number,
		chainId: string,
		handled: HandledSituation,
	): void {
		const now = nowIso8601();
		const decision: ReconcilerDecisionRecord = {
			id: randomUUID(),
			eventId,
			channel: event.channel,
			chainId,
			workstreamId: findString(event.payload, 'workstreamId'),
			facts: handled.facts,
			candidates: handled.candidates,
			pick: null,
			chosen: 0,
			decidedBy: 'rules',
			status: 'done',
			detail: handled.reason,
			jobRunId: null,
			subjectRunId: subjectRunId(event),
			createdAt: now,
			finishedAt: now,
		};
		insertDecision(this.#context.db, decision);
		this.#emit(decision);
	}

	async #ask(
		question: ReconcilerQuestion,
	): Promise<Readonly<{ pick: number | null; detail: string | null }>> {
		const labels = question.candidates.map((candidate) => candidate.label);
		try {
			const output = await runAutomaticJob(
				this.#context.db,
				'reconcile',
				reconcilerPrompt(question),
				async (task, job) => pickOutput(labels, await this.#choose(task, job, labels.length)),
			);
			const picked = outputPick(output);
			return { pick: picked === null ? null : picked - 1, detail: null };
		} catch (error) {
			return { pick: null, detail: `Malini could not ask the model: ${describeError(error)}` };
		}
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
			if (this.#closed(decision.workstreamId)) return this.#dismiss(decision, WORKSTREAM_CLOSED);
			const asking = this.#save({ ...decision, status: 'asking', finishedAt: null });
			this.#replaceAsks(this.#subject(asking), (other) => other.id === asking.id, ASKED_AGAIN);
			this.#background(this.#notify(asking, candidate.reason));
			return asking;
		}
		if (candidate.kind === 'run-job') return this.#runJob(decision, candidate);
		return this.#wake(decision, candidate);
	}

	async #wake(
		decision: ReconcilerDecisionRecord,
		wake: Extract<ReconcilerCandidate, { kind: 'wake-chat' }>,
	): Promise<ReconcilerDecisionRecord> {
		try {
			await this.#deliver({
				sessionId: wake.sessionId,
				prompt: wake.report,
				fromWorkstreamId: wake.from === wake.workstreamId ? null : wake.from,
				chainId: decision.chainId,
				causeEventId: decision.eventId,
			});
			return this.#save({ ...decision, status: 'done', finishedAt: nowIso8601() });
		} catch (error) {
			return this.#save({
				...decision,
				status: 'failed',
				detail: `Malini could not wake the chat: ${describeError(error)}`,
				finishedAt: nowIso8601(),
			});
		}
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

	#answerWithRun(event: DispatchedEvent): void {
		if (event.channel !== JOBS_RUN_FINISHED_CHANNEL) return;
		const runId = findString(isRecord(event.payload) ? event.payload['run'] : null, 'id');
		const run = runId === null ? null : getJobRun(this.#context.db, runId);
		if (!run || (run.status !== 'succeeded' && run.status !== 'failed')) return;
		this.#replaceAsks(
			runSubject(run),
			(asking) => asking.subjectRunId === run.id,
			`${run.title} ran again.`,
		);
	}

	#replaceAsks(
		subject: string,
		keep: (asking: ReconcilerDecisionRecord) => boolean,
		detail: string,
	): void {
		for (const asking of listAskingDecisions(this.#context.db)) {
			if (!keep(asking) && this.#subject(asking) === subject) this.#dismiss(asking, detail);
		}
	}

	#subject(decision: ReconcilerDecisionRecord): string {
		const run =
			decision.subjectRunId === null ? null : getJobRun(this.#context.db, decision.subjectRunId);
		return run ? runSubject(run) : `${decision.channel}:${decision.workstreamId ?? ''}`;
	}

	#closed(workstreamId: string | null): boolean {
		return workstreamId !== null && isWorkstreamClosed(this.#context.db, workstreamId);
	}

	#closedSince(decision: ReconcilerDecisionRecord): string {
		const archivedAt = getArchivedWorkstream(
			this.#context.db,
			decision.workstreamId ?? '',
		)?.archivedAt;
		if (archivedAt === undefined) return nowIso8601();
		return archivedAt > decision.createdAt ? archivedAt : decision.createdAt;
	}

	#dismiss(
		decision: ReconcilerDecisionRecord,
		detail: string,
		finishedAt = nowIso8601(),
	): ReconcilerDecisionRecord {
		return this.#save({ ...decision, status: 'dismissed', detail, finishedAt });
	}

	#situation(event: DispatchedEvent, chainId: string): ReconcilerSituation | null {
		switch (event.channel) {
			case JOBS_RUN_FINISHED_CHANNEL:
				return this.#jobRunSituation(event.payload, chainId);
			case REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL:
				return this.#conflictSituation(event, chainId);
			default:
				return null;
		}
	}

	#jobRunSituation(payload: unknown, chainId: string): ReconcilerSituation | null {
		const { db } = this.#context;
		const runId = findString(isRecord(payload) ? payload['run'] : null, 'id');
		const run = runId === null ? null : getJobRun(db, runId);
		if (!run || (run.status !== 'succeeded' && run.status !== 'failed')) return null;
		if (this.#closed(run.workstreamId)) return null;
		const definition = getJobDefinition(db, run.definitionId);
		if (!definition || isAutomaticJobBuiltin(definition.builtin)) return null;
		const chat = this.#chat(run.chatSessionId);
		if (run.status === 'succeeded' && chat === null) return null;
		const workstream = run.workstreamId === null ? null : getWorkstream(db, run.workstreamId);
		const merging = run.workstreamId !== null && this.#rules.shipping.merging(run.workstreamId);
		const shipped =
			isShippingJobBuiltin(definition.builtin) && (merging || run.origin === 'merge-queue');
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
			handledBy: shipped ? `${merging ? 'Merge' : 'Shipping'} takes ${run.title} from here.` : null,
			retry,
			runsInChain: countChainJobRuns(
				db,
				run.chainId,
				run.definitionId,
				retryTarget(run),
				run.origin,
			),
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
		if (!workstream || this.#closed(workstream.id) || !Array.isArray(paths)) return null;
		const resolver = getBuiltinJobDefinition(db, 'resolve-conflicts');
		const resolving =
			resolver !== null && activeWorkstreamJobRun(db, workstream.id, [resolver.id]) !== null;
		const merging = this.#rules.shipping.merging(workstream.id);
		const chat = this.#chat(requesterSessionId(db, event.cause));
		return {
			kind: 'conflict',
			workstreamId: workstream.id,
			workstreamName: workstream.name,
			conflictedPaths: paths.filter((path): path is string => typeof path === 'string'),
			resolverId: resolver?.id ?? null,
			chat,
			handledBy: resolving
				? 'Resolve conflicts is already resolving them.'
				: merging
					? `Merge resolves them while it merges “${workstream.name}”.`
					: null,
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
			lastOutcome: latest?.outcome ?? null,
			lastNeeds: latest?.needs ?? null,
		};
	}

	async #notify(decision: ReconcilerDecisionRecord, reason: string): Promise<void> {
		const { commands, db } = this.#context;
		try {
			if ((await commands.call('app.notification-permission-granted', undefined)) !== true) return;
			const workstreamId =
				decision.workstreamId === null
					? null
					: (workstreamLeads(listWorkstreams(db)).get(decision.workstreamId) ??
						decision.workstreamId);
			const session = workstreamId === null ? null : latestSessionForWorkstream(db, workstreamId);
			const subject = decision.subjectRunId === null ? null : getJobRun(db, decision.subjectRunId);
			const workstream =
				decision.workstreamId === null ? null : getWorkstream(db, decision.workstreamId);
			await commands.call('app.notify', {
				options: {
					title: [subject?.title ?? UNRUN_QUESTION_TITLE, workstream?.name]
						.filter((part) => part !== undefined)
						.join(' · '),
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

	#background(work: Promise<unknown>): void {
		void work.catch((error: unknown) => this.#log(`jobs: ${describeError(error)}`));
	}
}

function subjectKey(event: DispatchedEvent): string | null {
	const { channel, payload } = event;
	if (channel === JOBS_RUN_FINISHED_CHANNEL) {
		const run = isRecord(payload) ? payload['run'] : null;
		const status = isRecord(run) ? run['status'] : null;
		const id = findString(run, 'id');
		if (id === null) return null;
		return status === 'succeeded' || status === 'failed' ? `run:${id}` : null;
	}
	if (channel === REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL) {
		const workstreamId = findString(payload, 'workstreamId');
		return workstreamId === null ? null : `conflict:${workstreamId}`;
	}
	return null;
}

function runSubject(run: JobRunRecord): string {
	return `job:${run.definitionId}:${run.workstreamId ?? ''}`;
}

function subjectRunId(event: DispatchedEvent): string | null {
	return event.cause?.kind === 'job-run' ? event.cause.id : null;
}

function requesterSessionId(db: MaliniDatabase, cause: EventCause | null): string | null {
	let current = cause;
	for (let hop = 0; current !== null && hop < CAUSE_HOPS; hop += 1) {
		if (current.kind === 'chat-turn') return null;
		if (current.kind === 'job-run') return getJobRun(db, current.id)?.chatSessionId ?? null;
		current = getLoggedEvent(db, Number(current.id))?.cause ?? null;
	}
	return null;
}

function retryTarget(
	run: JobRunRecord,
): Pick<JobRunRecord, 'workstreamId' | 'repositoryId' | 'scope'> {
	return { workstreamId: run.workstreamId, repositoryId: run.repositoryId, scope: run.scope };
}
