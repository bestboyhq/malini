import type { AgentEvent } from '$lib/chat/domain/events';
import type { SessionRecord } from '$lib/chat/domain/session-record';

export type PreparedPlan = Readonly<{
	session: SessionRecord;
	label: string;
}>;

const PREPARED_PLAN_LIMIT = 3;
const PLAN_LABEL_LIMIT = 54;

export function newestWorkstreamChats(
	sessions: readonly SessionRecord[],
	workstreamId: string,
): readonly SessionRecord[] {
	return sessions
		.filter((session) => session.workstreamId === workstreamId)
		.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function preparedPlans(
	chats: readonly SessionRecord[],
	eventsFor: (sessionId: string) => readonly AgentEvent[],
): readonly PreparedPlan[] {
	const plans: PreparedPlan[] = [];
	for (const session of chats) {
		const text = latestPlanText(eventsFor(session.id));
		if (text === null) continue;
		const label = planLabel(text);
		if (label) plans.push({ session, label });
	}
	return plans.slice(0, PREPARED_PLAN_LIMIT);
}

function latestPlanText(events: readonly AgentEvent[]): string | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === 'plan.updated') return event.text;
	}
	return null;
}

export function planLabel(text: string): string {
	const firstUsefulLine = text
		.split('\n')
		.map((line) => line.replace(/^\s*(?:[-*#]|\d+[.)])\s*/u, '').trim())
		.find(Boolean);
	if (!firstUsefulLine) return '';
	return firstUsefulLine.length > PLAN_LABEL_LIMIT
		? `${firstUsefulLine.slice(0, PLAN_LABEL_LIMIT - 1).trimEnd()}…`
		: firstUsefulLine;
}
