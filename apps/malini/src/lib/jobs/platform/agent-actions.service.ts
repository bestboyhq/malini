import { randomUUID } from 'node:crypto';
import { JOBS_AGENT_ACTION_CHANGED_CHANNEL } from '$contract/events';
import type { AgentActionChangedEvent, AgentActionRecord, AgentActionStatus } from '$contract/jobs';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { finishAgentActionRow, insertAgentAction } from './agent-actions.repository';

export type AgentActionContext = Pick<MainContext, 'db' | 'events'>;

export type AgentActionStart = Omit<AgentActionRecord, 'id' | 'startedAt' | 'finishedAt'>;

export function recordAgentAction(
	{ db, events }: AgentActionContext,
	start: AgentActionStart,
): AgentActionRecord {
	const startedAt = nowIso8601();
	const action: AgentActionRecord = {
		...start,
		id: randomUUID(),
		startedAt,
		finishedAt: start.status === 'running' ? null : startedAt,
	};
	insertAgentAction(db, action);
	changed(events, action);
	return action;
}

export function finishAgentAction(
	{ db, events }: AgentActionContext,
	id: string,
	status: Exclude<AgentActionStatus, 'running'>,
	output: string,
): void {
	const action = finishAgentActionRow(db, id, status, output, nowIso8601());
	if (action) changed(events, action);
}

function changed(events: AgentActionContext['events'], action: AgentActionRecord): void {
	const payload: AgentActionChangedEvent = { action };
	events.emit(JOBS_AGENT_ACTION_CHANGED_CHANNEL, payload);
}
