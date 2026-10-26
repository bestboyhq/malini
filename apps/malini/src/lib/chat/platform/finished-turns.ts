import type { AgentEventEnvelope } from '$contract/agent';
import { PAUSED_FOR_EXIT_ERROR, isCancellationError } from '$contract/agent-state-machine';
import type { ChatTurnFinishedPayload } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { parseTurnReport } from '../domain/turn-report';
import { turnEndedOverBackgroundCommands } from './events.repository';
import { userSessionWorkstreamId } from './sessions.repository';

// ponytail: forgets every announced run past 2 000, so a turn that ended over background commands could announce again when it completes; key on agent_runs if that ever shows up
const ANNOUNCED_LIMIT = 2_000;

export class FinishedTurns {
	readonly #db: MaliniDatabase;
	readonly #announced = new Set<string>();

	constructor(db: MaliniDatabase) {
		this.#db = db;
	}

	after({ sessionId, runId, event }: AgentEventEnvelope): ChatTurnFinishedPayload | null {
		const type = event['type'];
		if (
			type !== 'run.completed' &&
			type !== 'run.failed' &&
			!turnEndedOverBackgroundCommands(event)
		) {
			return null;
		}
		const error = typeof event['error'] === 'string' ? event['error'] : null;
		if (error === PAUSED_FOR_EXIT_ERROR || this.#announced.has(runId)) return null;
		const workstreamId = userSessionWorkstreamId(this.#db, sessionId);
		if (workstreamId === null) return null;
		if (this.#announced.size >= ANNOUNCED_LIMIT) this.#announced.clear();
		this.#announced.add(runId);
		const report = parseTurnReport(typeof event['summary'] === 'string' ? event['summary'] : '');
		return {
			workstreamId,
			sessionId,
			runId,
			status:
				type !== 'run.failed'
					? 'succeeded'
					: isCancellationError(error ?? '')
						? 'cancelled'
						: 'failed',
			outcome: report.outcome,
			needs: report.needs.length > 0 ? report.needs.join('; ') : null,
		};
	}
}
