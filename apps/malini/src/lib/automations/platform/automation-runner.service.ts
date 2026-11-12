import type { AgentEventEnvelope } from '$contract/agent';
import {
	PAUSED_FOR_EXIT_ERROR,
	foldSessionStatus,
	isPausedRunEvent,
	isWaitingForUser,
	runEnding,
	type LifecycleEnvelope,
	type RunEnding,
	type SessionStatus,
} from '$contract/agent-state-machine';
import {
	CHAT_AGENT_EVENT_CHANNEL,
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_FINISHED_CHANNEL,
	AUTOMATIONS_RUN_STARTED_CHANNEL,
} from '$contract/events';
import type { Workstream, WorktreeStatus } from '$contract/repositories';
import {
	AUTOMATION_INTERRUPTED_DETAIL,
	AUTOMATIONS_MAX_CONCURRENT_SETTING,
	isAgentlessAutomationBuiltin,
	type AgentlessAutomationBuiltin,
	type AutomationDefinitionRecord,
	type AutomationRunChangedEvent,
	type AutomationRunRecord,
	type AutomationRunStatus,
} from '$contract/automations';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { CommandOutcome } from '$main/ipc/registry';
import {
	clonePlannedRepository,
	createPlannedWorkstream,
	getWorkstream,
	isWorkstreamClosed,
	planRepositoryWorkstream,
	prepareStartedWorkstream,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import {
	agentRunWasAlreadyGone,
	foldedAutomationContext,
	isActiveAutomationRunStatus,
	isFinishedAutomationRunStatus,
	isPendingAutomationRunStatus,
	automationPrompt,
	automationsMaxConcurrent,
	truncateAutomationContext,
	workstreamWasBusy,
} from '../domain/automation-run';
import { updateFromMainAutomationContext } from '../domain/update-from-main-context';
import { triggeredBefore } from './event-log.repository';
import { findString, type DispatchedEvent } from './event-log.service';
import {
	getBuiltinAutomationDefinition,
	getAutomationDefinition,
} from './automation-definitions.repository';
import {
	appendAutomationRunContext,
	childAutomationRun,
	findActiveAutomationRunForSession,
	findAutomationRunOfAgentRun,
	getAutomationRun,
	getAutomationRunContext,
	insertAutomationRun,
	listPendingThenAutomationRuns,
	listUnfinishedAutomationRuns,
	saveAutomationRun,
} from './automation-runs.repository';
import {
	getSession,
	getWorkstreamRun,
	hasTurnReport,
	resumesTurn,
	turnEndedOverBackgroundCommands,
} from '$lib/chat/chat.platform';
import { chooseSessionSkills } from '$lib/skills/skills.platform';
import { BackgroundWork } from './background-work';

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
} as const satisfies Record<
	Exclude<AgentlessAutomationBuiltin, 'update-from-main' | 'capture-brain'>,
	object
>;

export const BUSY_RETRY_MS = 3_000;

export const WORKSTREAM_CLOSED = 'Its workstream was closed.';

type SessionState = Readonly<{
	status: SessionStatus;
	runId: string | null;
	summary: string | null;
	paused: boolean;
}>;

export class AutomationRunner {
	readonly #context: MainContext;
	readonly #log: (line: string) => void;
	readonly #retryAt = new Map<string, number>();
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	readonly #unsubscribes: Array<() => void> = [];
	#safety: ReturnType<typeof setTimeout> | null = null;
	#pass: Promise<void> | null = null;
	#markRecovered = (): void => {};
	readonly #recovered = new Promise<void>((resolve) => (this.#markRecovered = resolve));
	#again = false;
	#stopped = false;

	readonly #work: BackgroundWork;

	constructor(context: MainContext, log: (line: string) => void, work = new BackgroundWork(log)) {
		this.#context = context;
		this.#log = log;
		this.#work = work;
	}

	start(): void {
		const { events, commands } = this.#context;
		this.#unsubscribes.push(
			events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (envelope) => this.#onAgentEvent(envelope)),
			commands.observe((outcome) => this.#onCommand(outcome)),
		);
		this.#background(this.#recover().finally(() => this.#markRecovered()));
	}

	recovered(): Promise<void> {
		return this.#recovered;
	}

	dispose(): void {
		this.#stopped = true;
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
		if (this.#safety) clearTimeout(this.#safety);
		this.#safety = null;
	}

	enqueue(automationRun: AutomationRunRecord, context: string | null): AutomationRunRecord {
		insertAutomationRun(this.#context.db, automationRun, context);
		this.#emit(automationRun, null);
		if (automationRun.status === 'queued') this.kick();
		return automationRun;
	}

	fold(
		automationRun: AutomationRunRecord,
		context: string | null,
		promote: boolean,
	): AutomationRunRecord | null {
		const { db } = this.#context;
		const folded = this.#update(automationRun.id, (current) =>
			isPendingAutomationRunStatus(current.status)
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
			const merged = foldedAutomationContext(getAutomationRunContext(db, folded.id), context);
			if (merged !== null) appendAutomationRunContext(db, folded.id, merged);
		}
		return folded;
	}

	confirm(automationRun: AutomationRunRecord): AutomationRunRecord {
		return (
			this.#update(automationRun.id, (current) =>
				current.status === 'waiting' ? { ...current, status: 'queued' } : null,
			) ??
			getAutomationRun(this.#context.db, automationRun.id) ??
			automationRun
		);
	}

	async cancel(
		automationRun: AutomationRunRecord,
		detail: string | null = null,
	): Promise<AutomationRunRecord> {
		if (isActiveAutomationRunStatus(automationRun.status) && automationRun.sessionId !== null) {
			await this.#stopAgentRun(automationRun.id, automationRun.sessionId, automationRun.agentRunId);
		}
		return (
			this.#finish(automationRun.id, 'cancelled', detail) ??
			getAutomationRun(this.#context.db, automationRun.id) ??
			automationRun
		);
	}

	async close(workstreamId: string): Promise<void> {
		for (const automationRun of listUnfinishedAutomationRuns(this.#context.db)) {
			if (automationRun.workstreamId === workstreamId)
				await this.cancel(automationRun, WORKSTREAM_CLOSED);
		}
	}

	kick(): void {
		if (this.#stopped) return;
		this.#again = true;
		if (this.#pass) return;
		this.#pass = this.#schedule()
			.catch((error: unknown) => {
				this.#again = false;
				this.#log(`automations: scheduling failed: ${describeError(error)}`);
			})
			.finally(() => {
				this.#pass = null;
				if (this.#again) this.kick();
			});
		this.#work.add(this.#pass);
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
		const unfinished = listUnfinishedAutomationRuns(this.#context.db);
		let running = unfinished.filter((automationRun) => automationRun.status === 'running').length;
		const blocked = new Set(
			unfinished.flatMap((automationRun) =>
				isActiveAutomationRunStatus(automationRun.status) && automationRun.workstreamId !== null
					? [automationRun.workstreamId]
					: [],
			),
		);
		const resolver =
			getBuiltinAutomationDefinition(this.#context.db, 'resolve-conflicts')?.id ?? null;
		const queuedRuns = unfinished.filter((automationRun) => automationRun.status === 'queued');
		const resolversFirst = [
			...queuedRuns.filter((automationRun) => automationRun.definitionId === resolver),
			...queuedRuns.filter((automationRun) => automationRun.definitionId !== resolver),
		];
		for (const queued of resolversFirst) {
			if (this.#stopped || running >= cap) return;
			const { workstreamId } = queued;
			if (this.#awaitsItsAutomation(queued)) continue;
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
			return automationsMaxConcurrent(settings[AUTOMATIONS_MAX_CONCURRENT_SETTING]);
		} catch (error) {
			this.#log(`automations: could not read the concurrency setting: ${describeError(error)}`);
			return automationsMaxConcurrent(null);
		}
	}

	async #agentWorking(workstreamId: string): Promise<boolean> {
		try {
			return await this.#context.commands.call('chat.workstream-has-working-run', { workstreamId });
		} catch (error) {
			this.#log(
				`automations: could not check \`${workstreamId}\` for working runs: ${describeError(error)}`,
			);
			return true;
		}
	}

	async #dispatch(automationRun: AutomationRunRecord): Promise<void> {
		const { db, commands } = this.#context;
		try {
			const definition = getAutomationDefinition(db, automationRun.definitionId);
			if (!definition) throw new Error('This automation no longer exists.');
			if (isAgentlessAutomationBuiltin(definition.builtin)) {
				if (automationRun.workstreamId === null)
					throw new Error(`${definition.name} needs a workstream.`);
				await this.#runAgentless(automationRun, definition.builtin, automationRun.workstreamId);
				return;
			}
			const workstreamId =
				automationRun.workstreamId ?? (await this.#createWorkstream(automationRun));
			if (!this.#dispatching(automationRun.id)) return;
			const runContext = getAutomationRunContext(db, automationRun.id);
			const conflicts =
				definition.builtin === 'resolve-conflicts'
					? await this.#conflicts(automationRun.id, workstreamId)
					: null;
			if (!this.#dispatching(automationRun.id)) return;
			const sessionId =
				automationRun.sessionId ??
				(await commands.call('chat.start-session', {
					workstreamId,
					provider: definition.provider,
					model: definition.model,
					origin: 'automation',
					displayName: automationRun.title,
				}));
			chooseSessionSkills(db, sessionId, definition.skills);
			const withSession = this.#update(automationRun.id, (current) =>
				current.status === 'running' && !this.#stopped ? { ...current, sessionId } : null,
			);
			if (!withSession) return;
			const agentRunId = await commands.call('chat.send-prompt', {
				sessionId,
				prompt: automationPrompt(
					automationPrompt(definition.instructions, runContext),
					conflicts === runContext ? null : conflicts,
				),
				profile: { effort: definition.effort, mode: 'agent', access: 'auto' },
				automated: true,
				chainId: automationRun.chainId,
			});
			this.#update(automationRun.id, (current) =>
				isActiveAutomationRunStatus(current.status) && current.agentRunId !== agentRunId
					? { ...current, agentRunId }
					: null,
			);
			if (getAutomationRun(db, automationRun.id)?.status === 'cancelled') {
				await this.#stopAgentRun(automationRun.id, sessionId, agentRunId);
			}
		} catch (error) {
			if (workstreamWasBusy(error) && this.#requeue(automationRun.id)) return;
			this.#finish(
				automationRun.id,
				'failed',
				`Could not start the automation: ${describeError(error)}`,
			);
		}
	}

	async #runAgentless(
		automationRun: AutomationRunRecord,
		builtin: AgentlessAutomationBuiltin,
		workstreamId: string,
	): Promise<void> {
		if (builtin === 'update-from-main') {
			await this.#updateFromMain(automationRun, workstreamId);
			return;
		}
		if (builtin === 'capture-brain') {
			await this.#captureBrain(automationRun.id);
			return;
		}
		const { command, opening, pushing } = SHIPPING[builtin];
		try {
			const { pullRequestUrl } = await this.#context.commands.call(command, { workstreamId });
			this.#succeed(automationRun.id, pullRequestUrl ? `${pushing} ${pullRequestUrl}` : opening);
		} catch (error) {
			this.#finish(automationRun.id, 'failed', describeError(error));
		}
	}

	async #captureBrain(automationRunId: string): Promise<void> {
		try {
			const { chats, turns } = await this.#context.commands.call('brain.capture', undefined);
			this.#succeed(
				automationRunId,
				chats === 0 ? 'Nothing new' : `${counted(chats, 'chat')}, ${counted(turns, 'turn')}`,
			);
		} catch (error) {
			this.#finish(automationRunId, 'failed', describeError(error));
		}
	}

	async #updateFromMain(automationRun: AutomationRunRecord, workstreamId: string): Promise<void> {
		const workstream = this.#workstream(workstreamId);
		const baseBranch = await this.#baseBranch(workstream);
		if (!baseBranch) throw new Error('This workstream has no base branch to update from.');
		const status = await this.#context.commands.call('repositories.workstream-status', {
			workstreamId,
		});
		const stopped = hasConflictedMerge(status);
		const conflicted = stopped
			? status
			: await this.#mergeBase(automationRun.id, status, workstreamId, baseBranch);
		if (conflicted === null || !this.#dispatching(automationRun.id)) return;
		const files = conflicted.conflictedPaths.length;
		const where = `${files} ${files === 1 ? 'file' : 'files'}`;
		this.#succeed(
			automationRun.id,
			stopped
				? `A merge had already stopped on conflicts in ${where}.`
				: `Stopped on conflicts in ${where}.`,
		);
	}

	async #conflicts(automationRunId: string, workstreamId: string): Promise<string | null> {
		const workstream = this.#workstream(workstreamId);
		const status = await this.#context.commands.call('repositories.workstream-status', {
			workstreamId,
		});
		if (!hasConflictedMerge(status) && status.conflictMarkerPaths.length === 0) {
			this.#succeed(automationRunId, 'No conflicts to resolve.');
			return null;
		}
		return updateFromMainAutomationContext({
			branch: workstream.branch,
			baseBranch: (await this.#baseBranch(workstream)) ?? '',
			conflictedPaths: [...new Set([...status.conflictedPaths, ...status.conflictMarkerPaths])],
			conflictMarkerPaths: status.conflictMarkerPaths,
		});
	}

	#workstream(workstreamId: string): Workstream {
		const workstream = getWorkstream(this.#context.db, workstreamId);
		if (!workstream) throw new Error('The workstream for this automation no longer exists.');
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
		automationRunId: string,
		status: WorktreeStatus,
		workstreamId: string,
		baseBranch: string,
	): Promise<WorktreeStatus | null> {
		const { commands } = this.#context;
		const blocker = updateBlocker(status);
		if (blocker !== null) {
			this.#finish(automationRunId, 'failed', blocker);
			return null;
		}
		const args = { workstreamId, baseBranch };
		const behind = await commands.call('repositories.count-behind-base', args);
		if (!this.#dispatching(automationRunId)) return null;
		if (behind === 0) {
			this.#succeed(automationRunId, `Already up to date with ${baseBranch}`);
			return null;
		}
		await commands.call('repositories.pull-workstream', args);
		const merged = await commands.call('repositories.workstream-status', { workstreamId });
		if (merged.operationInProgress === 'merge') return merged;
		this.#succeed(
			automationRunId,
			`Merged ${behind} ${behind === 1 ? 'commit' : 'commits'} from ${baseBranch}`,
		);
		return null;
	}

	#dispatching(automationRunId: string): boolean {
		return (
			!this.#stopped && getAutomationRun(this.#context.db, automationRunId)?.status === 'running'
		);
	}

	async #createWorkstream(automationRun: AutomationRunRecord): Promise<string> {
		const { db, commands } = this.#context;
		const planned =
			automationRun.repositoryId === null
				? null
				: await planRepositoryWorkstream(db, automationRun.repositoryId);
		if (!planned) throw new Error('The repository for this automation is no longer connected.');
		const plan =
			automationRun.origin === 'schedule' ? { ...planned, name: automationRun.title } : planned;
		await createPlannedWorkstream(commands, plan, await clonePlannedRepository(commands, plan));
		const { workstreamId } = plan;
		this.#update(automationRun.id, (current) => ({ ...current, workstreamId }));
		if (!this.#dispatching(automationRun.id)) return workstreamId;
		await prepareStartedWorkstream(this.#context, workstreamId, (line) =>
			this.#log(`automations: ${line}`),
		);
		return workstreamId;
	}

	#requeue(automationRunId: string): boolean {
		const requeued = this.#update(automationRunId, (current) =>
			current.status === 'running' ? { ...current, status: 'queued', startedAt: null } : null,
		);
		if (!requeued) return false;
		this.#retryAt.set(automationRunId, Date.now() + BUSY_RETRY_MS);
		this.#later(BUSY_RETRY_MS);
		return true;
	}

	async #stopAgentRun(
		automationRunId: string,
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
			this.#log(
				`automations: could not stop the agent run of \`${automationRunId}\`: ${describeError(error)}`,
			);
		}
	}

	#onAgentEvent(envelope: AgentEventEnvelope): void {
		try {
			const type = envelope.event['type'];
			if (typeof type === 'string' && resumesTurn({ type })) this.#wentOn(envelope);
			if (type === 'run.started') this.#resumed(envelope.sessionId, envelope.runId);
			else if (type === 'approval.requested' || type === 'question.requested')
				this.#waiting(envelope.sessionId);
			else if (type === 'approval.withdrawn' || type === 'question.withdrawn')
				this.#stoppedWaiting(envelope.sessionId);
			else if (type === 'run.completed' || type === 'run.failed') {
				this.#ended(envelope);
				this.kick();
			} else if (turnEndedOverBackgroundCommands(envelope.event)) {
				this.#endedOverBackgroundCommands(envelope);
				this.kick();
			}
		} catch (error) {
			this.#log(`automations: could not track an agent event: ${describeError(error)}`);
		}
	}

	#resumed(sessionId: string, agentRunId: string): void {
		const automationRun = findActiveAutomationRunForSession(this.#context.db, sessionId);
		if (!automationRun) return;
		this.#update(automationRun.id, (current) =>
			current.status === 'needs-you' || current.agentRunId !== agentRunId
				? { ...current, status: 'running', agentRunId }
				: null,
		);
	}

	#waiting(sessionId: string): void {
		const automationRun = findActiveAutomationRunForSession(this.#context.db, sessionId);
		if (!automationRun) return;
		this.#update(automationRun.id, (current) =>
			current.status === 'running' ? { ...current, status: 'needs-you' } : null,
		);
	}

	#ended(envelope: AgentEventEnvelope): void {
		const automationRun = findActiveAutomationRunForSession(this.#context.db, envelope.sessionId);
		if (!automationRun) return;
		if (envelope.event['type'] === 'run.completed') {
			this.#succeed(automationRun.id, text(envelope.event['summary']));
			return;
		}
		const error = text(envelope.event['error']) ?? 'The agent run failed.';
		if (error === PAUSED_FOR_EXIT_ERROR || isPausedRunEvent(envelope.event)) return;
		const ending = runEnding(error);
		this.#finish(automationRun.id, ending, ending === 'cancelled' ? null : error);
	}

	#endedOverBackgroundCommands(envelope: AgentEventEnvelope): void {
		const summary = text(envelope.event['summary']);
		if (summary === null) return;
		const automationRun = findActiveAutomationRunForSession(this.#context.db, envelope.sessionId);
		if (!automationRun) return;
		this.#succeed(automationRun.id, summary);
	}

	#wentOn({ sessionId, runId }: AgentEventEnvelope): void {
		const automationRun = findAutomationRunOfAgentRun(this.#context.db, sessionId, runId);
		if (automationRun?.status !== 'succeeded') return;
		this.#update(automationRun.id, (current) =>
			current.status === 'succeeded' && current.agentRunId === runId
				? { ...current, status: 'running', detail: null, finishedAt: null }
				: null,
		);
	}

	#awaitsItsAutomation({ parentRunId, origin }: AutomationRunRecord): boolean {
		const automation =
			parentRunId === null ? null : getAutomationRun(this.#context.db, parentRunId);
		if (!automation) return false;
		if (origin === 'then' && automation.status !== 'succeeded') return true;
		return this.#mayGoOn(automation) && !hasTurnReport(automation.detail ?? '');
	}

	#mayGoOn({ status, workstreamId, agentRunId }: AutomationRunRecord): boolean {
		if (status !== 'succeeded' || workstreamId === null || agentRunId === null) return false;
		return getWorkstreamRun(this.#context.db, workstreamId, agentRunId)?.completedAt === null;
	}

	#onCommand(outcome: CommandOutcome): void {
		if (!outcome.ok) return;
		if (outcome.command !== 'chat.decide-approval' && outcome.command !== 'chat.answer-question')
			return;
		const sessionId = stringField(outcome.args, 'sessionId');
		if (sessionId !== null) this.#stoppedWaiting(sessionId);
	}

	#stoppedWaiting(sessionId: string): void {
		if (isWaitingForUser(getSession(this.#context.db, sessionId)?.status)) return;
		const automationRun = findActiveAutomationRunForSession(this.#context.db, sessionId);
		if (!automationRun) return;
		this.#update(automationRun.id, (current) =>
			current.status === 'needs-you' ? { ...current, status: 'running' } : null,
		);
	}

	#succeed(automationRunId: string, summary: string | null): void {
		this.#finish(automationRunId, 'succeeded', summary);
	}

	async startThen(event: DispatchedEvent): Promise<void> {
		const { db, commands } = this.#context;
		if (event.channel !== AUTOMATIONS_RUN_FINISHED_CHANNEL) return;
		const runId = findString(isRecord(event.payload) ? event.payload['run'] : null, 'id');
		const automationRun = runId === null ? null : getAutomationRun(db, runId);
		if (!automationRun || automationRun.workstreamId === null) return;
		const thenAutomationId =
			getAutomationDefinition(db, automationRun.definitionId)?.thenAutomationId ?? null;
		if (thenAutomationId === null || triggeredBefore(db, thenAutomationId, event.id)) return;
		if (childAutomationRun(db, automationRun.id, thenAutomationId)) return;
		if (automationRun.status !== 'succeeded') return;
		try {
			await commands.call('automations.run', {
				definitionId: thenAutomationId,
				workstreamId: automationRun.workstreamId,
				origin: 'then',
				parentRunId: automationRun.id,
				context: truncateAutomationContext(
					thenContext(automationRun, getAutomationDefinition(db, thenAutomationId)),
				),
				...(event.id === null ? {} : { causeEventId: event.id }),
			});
		} catch (error) {
			const next = getAutomationDefinition(db, thenAutomationId)?.name ?? 'the next automation';
			const failure = `Could not start ${next}: ${describeError(error)}`;
			this.#update(automationRun.id, (current) => ({
				...current,
				detail: current.detail ? `${current.detail}\n\n${failure}` : failure,
			}));
		}
	}

	#followAgain(automation: AutomationRunRecord): void {
		const { db } = this.#context;
		for (const then of listPendingThenAutomationRuns(db, automation.id)) {
			if (automation.status === 'succeeded') {
				const report = thenContext(automation, getAutomationDefinition(db, then.definitionId));
				appendAutomationRunContext(db, then.id, truncateAutomationContext(report));
			} else {
				this.#finish(then.id, 'cancelled', `${automation.title} went on and did not succeed.`);
			}
		}
	}

	async #recover(): Promise<void> {
		const { db } = this.#context;
		for (const automationRun of listUnfinishedAutomationRuns(db)) {
			if (this.#stopped) return;
			const closed =
				automationRun.workstreamId !== null && isWorkstreamClosed(db, automationRun.workstreamId);
			if (!closed && !isActiveAutomationRunStatus(automationRun.status)) continue;
			try {
				if (closed) await this.cancel(automationRun, WORKSTREAM_CLOSED);
				else await this.#recoverRun(automationRun);
			} catch (error) {
				this.#log(
					`automations: could not recover \`${automationRun.id}\`: ${describeError(error)}`,
				);
			}
		}
		this.kick();
	}

	async #recoverRun(automationRun: AutomationRunRecord): Promise<void> {
		const session =
			automationRun.sessionId === null ? null : await this.#sessionState(automationRun.sessionId);
		if (session?.paused) return;
		if (session === null || session.status === 'idle' || session.status === 'failed') {
			this.#finish(automationRun.id, 'interrupted', AUTOMATION_INTERRUPTED_DETAIL);
			return;
		}
		if (session.status === 'completed') {
			this.#succeed(automationRun.id, session.summary);
			return;
		}
		const status = session.status === 'running' ? 'running' : 'needs-you';
		const agentRunId = session.runId ?? automationRun.agentRunId;
		this.#update(automationRun.id, (current) =>
			current.status === automationRun.status &&
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
		automationRunId: string,
		ending: RunEnding,
		detail: string | null,
	): AutomationRunRecord | null {
		const status = ending === 'interrupted' ? 'failed' : ending;
		const interrupted = ending === 'interrupted' || (ending === 'failed' && this.#stopped);
		const finished = this.#update(automationRunId, (current) =>
			isFinishedAutomationRunStatus(current.status)
				? null
				: { ...current, status, interrupted, detail, finishedAt: nowIso8601() },
		);
		if (finished) {
			this.#retryAt.delete(automationRunId);
			this.#followAgain(finished);
		}
		return finished;
	}

	#update(
		automationRunId: string,
		change: (current: AutomationRunRecord) => AutomationRunRecord | null,
	): AutomationRunRecord | null {
		const current = getAutomationRun(this.#context.db, automationRunId);
		const next = current ? change(current) : null;
		if (!current || !next) return null;
		saveAutomationRun(this.#context.db, next);
		this.#emit(next, current.status);
		this.kick();
		return next;
	}

	#emit(automationRun: AutomationRunRecord, was: AutomationRunStatus | null): void {
		const { events } = this.#context;
		const payload: AutomationRunChangedEvent = { run: automationRun };
		events.emit(AUTOMATIONS_RUN_CHANGED_CHANNEL, payload);
		if (automationRun.status === 'running' && was === 'queued') {
			events.emit(AUTOMATIONS_RUN_STARTED_CHANNEL, payload);
		}
		if (
			isFinishedAutomationRunStatus(automationRun.status) &&
			was !== null &&
			!isFinishedAutomationRunStatus(was)
		) {
			events.emit(AUTOMATIONS_RUN_FINISHED_CHANNEL, payload);
		}
	}

	#armSafety(): void {
		if (this.#safety) clearTimeout(this.#safety);
		this.#safety = null;
		if (this.#stopped) return;
		const queued = listUnfinishedAutomationRuns(this.#context.db).some(
			(automationRun) => automationRun.status === 'queued',
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
		this.#work.add(work);
	}
}

function thenContext(
	{ title, detail }: AutomationRunRecord,
	then: AutomationDefinitionRecord | null,
): string {
	return detail && then?.boundary.before
		? `This automation runs after “${title}”, which finished with:\n\n${detail}`
		: `This automation runs after “${title}”.`;
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

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringField(value: unknown, key: string): string | null {
	return isRecord(value) ? text(value[key]) : null;
}

function lifecycleEnvelope({ runId, event }: AgentEventEnvelope): LifecycleEnvelope[] {
	const type = event['type'] === 'user.message' ? 'run.started' : event['type'];
	return typeof type === 'string' ? [{ runId, event: { ...event, type } }] : [];
}

function counted(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
