import type {
	AgentActionRecord,
	ChatTurnRecord,
	JobRunRecord,
	ReconcilerDecisionRecord,
} from '$contract/jobs';
import { jobRunLastActivityAt } from './job-run';

export type ActivityEntry =
	| Readonly<{
			kind: 'job';
			id: string;
			at: string;
			run: JobRunRecord;
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
	runs: readonly JobRunRecord[],
	turns: readonly ChatTurnRecord[],
	actions: readonly AgentActionRecord[],
	decisions: readonly ReconcilerDecisionRecord[] = [],
): ActivityEntry[] {
	const chronological = [...actions].sort((left, right) =>
		left.startedAt.localeCompare(right.startedAt),
	);
	const jobSessions = new Set(runs.flatMap((run) => (run.sessionId ? [run.sessionId] : [])));
	const turnRuns = new Set(turns.map((turn) => turn.runId));
	const startedBy = new Map(
		actions.flatMap((action) => {
			const runId = startedJobRunId(action);
			return runId ? [[runId, action] as const] : [];
		}),
	);
	const entries: ActivityEntry[] = [
		...runs.map((run): ActivityEntry => ({
			kind: 'job',
			id: run.id,
			at: jobRunLastActivityAt(run),
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
			.filter((action) => !jobSessions.has(action.sessionId) && !turnRuns.has(action.runId))
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
		case 'job':
			return entry.run.status === 'running' || entry.run.status === 'queued';
		case 'chat':
			return entry.turn.status === 'running';
		case 'call':
			return entry.action.status === 'running';
		case 'decision':
			return entry.decision.status === 'pending';
	}
}

function startedJobRunId(action: AgentActionRecord): string | null {
	if (action.tool !== 'jobs_run' || action.status !== 'succeeded' || action.output === null) {
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
