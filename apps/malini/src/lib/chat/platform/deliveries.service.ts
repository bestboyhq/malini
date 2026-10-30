import { randomUUID } from 'node:crypto';
import type { AgentRunProfile } from '$contract/agent';
import type { ChatDelivery } from '$contract/deliveries';
import { CHAT_DELIVERY_CHANGED_CHANNEL, type ChatTurnFinishedPayload } from '$contract/events';
import type { MainContext } from '$main/context';
import { get, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { startingSessionId } from '$lib/jobs/jobs.platform';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import {
	deliveryBatch,
	reportedTurnEnd,
	reportForLead,
	workstreamReport,
} from '../domain/deliveries';
import { isAlreadyActiveError } from '../domain/prompt-dispatch-failure';
import { parseRunProfile } from './agent/commands';
import {
	insertDelivery,
	getDelivery,
	sessionsWithWaitingDeliveries,
	settleDeliveries,
	waitingDeliveries,
	type NewDelivery,
} from './deliveries.repository';
import { sessionHasWorkingRun } from './events.repository';
import { chatTurnChainId, getRun } from './runs.repository';
import { getSession, latestSessionForWorkstream } from './sessions.repository';

const BUSY_RETRY_MS = 3_000;
const BUSY_RETRIES = 20;

type DeliveriesContext = Pick<MainContext, 'db' | 'commands' | 'events'>;

export class ChatDeliveries {
	readonly #context: DeliveriesContext;
	readonly #log: (line: string) => void;
	readonly #held = new Set<string>();
	readonly #flushing = new Set<string>();
	readonly #again = new Set<string>();
	readonly #retries = new Map<string, number>();
	readonly #timers = new Set<NodeJS.Timeout>();
	#stopped = false;

	constructor(context: DeliveriesContext, log: (line: string) => void) {
		this.#context = context;
		this.#log = log;
	}

	async deliver(delivery: NewDelivery): Promise<ChatDelivery> {
		const created = insertDelivery(this.#context.db, randomUUID(), delivery, nowIso8601());
		this.#emit(created);
		await this.flush(delivery.sessionId);
		return getDelivery(this.#context.db, created.id) ?? created;
	}

	hold(sessionId: string): void {
		this.#held.add(sessionId);
	}

	async release(sessionId: string): Promise<void> {
		this.#held.delete(sessionId);
		await this.flush(sessionId);
	}

	async flushAll(): Promise<void> {
		for (const sessionId of sessionsWithWaitingDeliveries(this.#context.db)) {
			await this.flush(sessionId);
		}
	}

	async turnFinished(turn: ChatTurnFinishedPayload, eventId: number | null): Promise<void> {
		await Promise.all([this.flush(turn.sessionId), this.#reportToStarter(turn, eventId)]);
	}

	async flush(sessionId: string): Promise<void> {
		const { db, commands } = this.#context;
		if (this.#stopped || this.#held.has(sessionId)) return;
		if (this.#flushing.has(sessionId)) {
			this.#again.add(sessionId);
			return;
		}
		this.#flushing.add(sessionId);
		try {
			const waiting = waitingDeliveries(db, sessionId);
			if (waiting.length === 0) return;
			const ids = waiting.map(({ id }) => id);
			const session = getSession(db, sessionId);
			if (!session || session.archivedAt !== null) {
				this.#settle(ids, { status: 'failed', detail: 'That chat is gone.' });
				return;
			}
			if (sessionHasWorkingRun(db, sessionId)) return;
			const batch = deliveryBatch(waiting);
			const profile =
				firstProfile(waiting.map((delivery) => delivery.profile)) ??
				latestPromptProfile(db, sessionId);
			let runId: string;
			try {
				runId = await commands.call('chat.send-prompt', {
					sessionId,
					prompt: batch.prompt,
					automated: batch.automated,
					...(batch.from === null ? {} : { from: batch.from }),
					...(batch.chainId === null ? {} : { chainId: batch.chainId }),
					...(batch.causeEventId === null ? {} : { causeEventId: batch.causeEventId }),
					...(profile === null ? {} : { profile }),
					...(batch.reports.length === 0 ? {} : { reports: batch.reports }),
					...(batch.decisions.length === 0 ? {} : { decisions: batch.decisions }),
				});
			} catch (error) {
				if (isAlreadyActiveError(describeError(error))) {
					this.#retryLater(sessionId);
					return;
				}
				this.#settle(ids, {
					status: 'failed',
					detail: `Malini could not deliver it: ${describeError(error)}`,
				});
				return;
			}
			this.#retries.delete(sessionId);
			this.#settle(ids, { status: 'delivered', runId, at: nowIso8601() });
		} finally {
			this.#flushing.delete(sessionId);
			if (this.#again.delete(sessionId)) {
				void this.flush(sessionId).catch((error: unknown) =>
					this.#log(`agent: could not deliver to \`${sessionId}\`: ${describeError(error)}`),
				);
			}
		}
	}

	stop(): void {
		this.#stopped = true;
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
	}

	async #reportToStarter(turn: ChatTurnFinishedPayload, eventId: number | null): Promise<void> {
		const { db } = this.#context;
		if (turn.status === 'cancelled') return;
		const workstream = getWorkstream(db, turn.workstreamId);
		if (!workstream?.startedBy) return;
		const starterId =
			startingSessionId(db, workstream.id) ??
			latestSessionForWorkstream(db, workstream.startedBy)?.id ??
			null;
		const starter = starterId === null ? null : getSession(db, starterId);
		if (!starter || starter.archivedAt !== null || starter.workstreamId === workstream.id) return;
		const summary = getRun(db, turn.runId)?.summary ?? null;
		const report = workstreamReport({
			workstreamId: workstream.id,
			runId: turn.runId,
			status: turn.status,
			outcome: turn.outcome,
			needs: turn.needs,
			summary,
			backgroundCommands: turn.backgroundCommands,
		});
		const body =
			summary && summary.trim().length > 0
				? reportForLead(summary.trim(), workstream.path)
				: [`Outcome: ${turn.outcome ?? 'none'}`, `Needs: ${turn.needs ?? 'nothing'}`].join('\n');
		await this.deliver({
			sessionId: starter.id,
			kind: 'report',
			prompt: [
				`“${workstream.name}” (\`${workstream.id}\`), a workstream you started, ${reportedTurnEnd(report)}.`,
				`Its checkout: ${workstream.path}`,
				body,
			].join('\n'),
			fromWorkstreamId: workstream.id,
			report,
			chainId: chatTurnChainId(db, turn.runId),
			causeEventId: eventId,
		});
	}

	#retryLater(sessionId: string): void {
		const tries = (this.#retries.get(sessionId) ?? 0) + 1;
		if (tries > BUSY_RETRIES) {
			this.#retries.delete(sessionId);
			this.#log(`agent: deliveries for \`${sessionId}\` wait for that chat's next turn to end`);
			return;
		}
		this.#retries.set(sessionId, tries);
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			void this.flush(sessionId).catch((error: unknown) =>
				this.#log(`agent: could not deliver to \`${sessionId}\`: ${describeError(error)}`),
			);
		}, BUSY_RETRY_MS);
		timer.unref();
		this.#timers.add(timer);
	}

	#settle(ids: readonly string[], outcome: Parameters<typeof settleDeliveries>[2]): void {
		for (const delivery of settleDeliveries(this.#context.db, ids, outcome)) this.#emit(delivery);
	}

	#emit(delivery: ChatDelivery): void {
		this.#context.events.emit(CHAT_DELIVERY_CHANGED_CHANNEL, { delivery });
	}
}

function firstProfile(profiles: readonly unknown[]): AgentRunProfile | null {
	for (const profile of profiles) {
		const parsed = safeProfile(profile);
		if (parsed) return parsed;
	}
	return null;
}

function latestPromptProfile(
	db: DeliveriesContext['db'],
	sessionId: string,
): AgentRunProfile | null {
	const row = get<{ profile: string }>(
		db,
		`SELECT profile FROM agent_runs
		 WHERE session_id = ? AND automated = 0 AND profile IS NOT NULL AND obsoleted_at IS NULL
		 ORDER BY started_at DESC, rowid DESC LIMIT 1`,
		sessionId,
	);
	if (!row) return null;
	try {
		return safeProfile(JSON.parse(row.profile));
	} catch {
		return null;
	}
}

function safeProfile(value: unknown): AgentRunProfile | null {
	try {
		return parseRunProfile(value);
	} catch {
		return null;
	}
}
