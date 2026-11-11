import type {
	AgentActionRecord,
	ChatTurnRecord,
	AutomationRunRecord,
	ReconcilerDecisionRecord,
} from '$contract/automations';
import { automationRunLastActivityAt, isFinishedAutomationRunStatus } from './automation-run';

export type ActivityEntry =
	| Readonly<{
			kind: 'automation';
			id: string;
			at: string;
			run: AutomationRunRecord;
			calls: readonly AgentActionRecord[];
			startedBy: AgentActionRecord | null;
	  }>
	| Readonly<{
			kind: 'chat';
			id: string;
			at: string;
			turn: ChatTurnRecord;
			calls: readonly AgentActionRecord[];
	  }>
	| Readonly<{ kind: 'call'; id: string; at: string; action: AgentActionRecord }>
	| Readonly<{ kind: 'decision'; id: string; at: string; decision: ReconcilerDecisionRecord }>;

export function activityEntries(
	runs: readonly AutomationRunRecord[],
	turns: readonly ChatTurnRecord[],
	actions: readonly AgentActionRecord[],
	decisions: readonly ReconcilerDecisionRecord[] = [],
): ActivityEntry[] {
	const chronological = [...actions].sort((left, right) =>
		left.startedAt.localeCompare(right.startedAt),
	);
	const automationSessions = new Set(runs.flatMap((run) => (run.sessionId ? [run.sessionId] : [])));
	const turnRuns = new Set(turns.map((turn) => turn.runId));
	const startedBy = new Map(
		actions.flatMap((action) => {
			const runId = startedAutomationRunId(action);
			return runId ? [[runId, action] as const] : [];
		}),
	);
	const entries: ActivityEntry[] = [
		...runs.map((run): ActivityEntry => ({
			kind: 'automation',
			id: run.id,
			at: automationRunLastActivityAt(run),
			run,
			calls:
				run.sessionId === null
					? []
					: chronological.filter((action) => action.sessionId === run.sessionId),
			startedBy: startedBy.get(run.id) ?? null,
		})),
		...turns.map((turn): ActivityEntry => ({
			kind: 'chat',
			id: turn.runId,
			at: turn.finishedAt ?? turn.startedAt,
			turn,
			calls: chronological.filter((action) => action.runId === turn.runId),
		})),
		...actions
			.filter((action) => !automationSessions.has(action.sessionId) && !turnRuns.has(action.runId))
			.map((action): ActivityEntry => ({
				kind: 'call',
				id: action.id,
				at: action.finishedAt ?? action.startedAt,
				action,
			})),
		...decisions.filter(decisionShown).map((decision): ActivityEntry => ({
			kind: 'decision',
			id: decision.id,
			at: decision.finishedAt ?? decision.createdAt,
			decision,
		})),
	];
	return entries.sort((left, right) => right.at.localeCompare(left.at));
}

export function decisionShown(decision: ReconcilerDecisionRecord): boolean {
	if (decision.status === 'asking') return false;
	if (decision.status === 'failed' || decision.decidedBy === 'you') return true;
	return decision.candidates[decision.chosen]?.kind !== 'nothing';
}

export function activityEntryRunning(entry: ActivityEntry): boolean {
	switch (entry.kind) {
		case 'automation':
			return !isFinishedAutomationRunStatus(entry.run.status);
		case 'chat':
			return entry.turn.status === 'running';
		case 'call':
			return entry.action.status === 'running';
		case 'decision':
			return entry.decision.status === 'pending';
	}
}

function startedAutomationRunId(action: AgentActionRecord): string | null {
	if (
		action.tool !== 'automations_run' ||
		action.status !== 'succeeded' ||
		action.output === null
	) {
		return null;
	}
	try {
		const result: unknown = JSON.parse(action.output);
		const id: unknown = typeof result === 'object' && result ? Reflect.get(result, 'id') : null;
		return typeof id === 'string' ? id : null;
	} catch {
		return null;
	}
}
