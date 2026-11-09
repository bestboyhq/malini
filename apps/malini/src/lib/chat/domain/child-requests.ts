import { isWaitingForUser } from '$contract/agent-state-machine';
import type { AutomationRunRecord } from '$contract/automations';
import type { EventEnvelope } from './events';
import type { SessionRecord } from './session-record';

export type AskingChild = Readonly<{
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

export function askingChildren(
	shownSessionId: string | null,
	automationRuns: readonly AutomationRunRecord[],
	childSessions: readonly SessionRecord[],
): AskingChild[] {
	const asking = new Map<string, AskingChild>();
	for (const run of automationRuns) {
		if (run.status !== 'needs-you' || run.sessionId === null || run.workstreamId === null) continue;
		asking.set(run.sessionId, {
			sessionId: run.sessionId,
			workstreamId: run.workstreamId,
			automation: run.title,
		});
	}
	for (const session of childSessions) {
		if (!isWaitingForUser(session.status) || asking.has(session.id)) continue;
		asking.set(session.id, askingSession(session));
	}
	if (shownSessionId !== null) asking.delete(shownSessionId);
	return [...asking.values()];
}

export function waitingElsewhere(
	shownSessionId: string | null,
	children: readonly AskingChild[],
	sessions: readonly SessionRecord[],
): AskingChild[] {
	const skipped = new Set([shownSessionId, ...children.map(({ sessionId }) => sessionId)]);
	return sessions
		.filter((session) => isWaitingForUser(session.status) && !skipped.has(session.id))
		.map(askingSession);
}

export function isUncheckedApproval(envelope: EventEnvelope): boolean {
	return (
		envelope.event.type === 'approval.requested' && envelope.event.autoModeUnavailable === true
	);
}

function askingSession(session: SessionRecord): AskingChild {
	return {
		sessionId: session.id,
		workstreamId: session.workstreamId,
		automation: session.origin === 'automation' ? session.displayName : null,
	};
}

export function descendantWorkstreamIds(
	rootId: string,
	workstreams: readonly Readonly<{ id: string; startedBy: string | null }>[],
): Set<string> {
	const descendants = new Set<string>();
	const reached = [rootId];
	for (let parentId = reached.pop(); parentId !== undefined; parentId = reached.pop()) {
		for (const workstream of workstreams) {
			if (workstream.startedBy !== parentId || descendants.has(workstream.id)) continue;
			descendants.add(workstream.id);
			reached.push(workstream.id);
		}
	}
	descendants.delete(rootId);
	return descendants;
}

export function requestEnvelopes(envelopes: readonly EventEnvelope[]): EventEnvelope[] {
	return envelopes.filter(({ event }) => REQUEST_EVENT_TYPES.has(event.type));
}
