import type { AgentBackgroundTask, AgentBackgroundTaskKind } from '$contract/agent';
import type { EventEnvelope } from './events';
import type { RunId } from './run';

export type BackgroundWork = Readonly<{
	runId: RunId;
	waiting: boolean;
	tasks: readonly AgentBackgroundTask[];
}>;

const KIND_NOUNS: Readonly<Record<AgentBackgroundTaskKind, readonly [string, string]>> = {
	command: ['background command', 'background commands'],
	agent: ['background agent', 'background agents'],
	task: ['background task', 'background tasks'],
};

export function latestBackgroundWork(
	envelopes: readonly EventEnvelope[],
	live: BackgroundWork | null,
): BackgroundWork | null {
	for (let index = envelopes.length - 1; index >= 0; index -= 1) {
		const envelope = envelopes[index];
		if (!envelope) continue;
		const { runId, event } = envelope;
		if (event.type === 'run.completed' || event.type === 'run.failed') return null;
		if (event.type !== 'background.updated') continue;
		const work =
			live?.runId === runId ? live : { runId, waiting: event.waiting, tasks: event.tasks };
		return work.tasks.length > 0 ? work : null;
	}
	return null;
}

export function backgroundWorkSummary(tasks: readonly AgentBackgroundTask[]): string {
	const kinds = new Set(tasks.map((task) => task.kind));
	const [kind] = kinds;
	const [one, many] = KIND_NOUNS[kinds.size === 1 && kind ? kind : 'task'];
	return `${tasks.length} ${tasks.length === 1 ? one : many}`;
}

export function backgroundTaskElapsed(startedAt: number, nowMs: number): string {
	const seconds = Math.max(0, Math.floor((nowMs - startedAt) / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
