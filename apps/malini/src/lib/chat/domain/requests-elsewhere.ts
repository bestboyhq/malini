import { isWaitingForUser } from '$contract/agent-state-machine';
import type { AutomationRunRecord } from '$contract/automations';
import type { EventEnvelope } from './events';
import type { SessionRecord } from './session-record';

export type AskingChat = Readonly<{
	sessionId: string;
	workstreamId: string;
	automation: string | null;
}>;

const REQUEST_EVENT_TYPES: ReadonlySet<string> = new Set([
	'approval.requested',
	'approval.decided',
	'question.requested',
	'question.answered',
	'tool.completed',
	'run.completed',
	'run.failed',
]);

export function askingAutomations(
	shownSessionId: string | null,
	automationRuns: readonly AutomationRunRecord[],
): AskingChat[] {
	const asking = new Map<string, AskingChat>();
	for (const run of automationRuns) {
		if (run.status !== 'needs-you' || run.sessionId === null || run.workstreamId === null) continue;
		if (run.sessionId === shownSessionId) continue;
		asking.set(run.sessionId, {
			sessionId: run.sessionId,
			workstreamId: run.workstreamId,
			automation: run.title,
		});
	}
	return [...asking.values()];
}

export function waitingElsewhere(
	shownSessionId: string | null,
	asking: readonly AskingChat[],
	sessions: readonly SessionRecord[],
): AskingChat[] {
	const skipped = new Set([shownSessionId, ...asking.map(({ sessionId }) => sessionId)]);
	return sessions
		.filter((session) => isWaitingForUser(session.status) && !skipped.has(session.id))
		.map((session) => ({
			sessionId: session.id,
			workstreamId: session.workstreamId,
			automation: session.origin === 'automation' ? session.displayName : null,
		}));
}

export function isUncheckedApproval(envelope: EventEnvelope): boolean {
	return (
		envelope.event.type === 'approval.requested' && envelope.event.autoModeUnavailable === true
	);
}

export function requestEnvelopes(envelopes: readonly EventEnvelope[]): EventEnvelope[] {
	return envelopes.filter(({ event }) => REQUEST_EVENT_TYPES.has(event.type));
}
