import type { AgentBackgroundTask, AgentBackgroundTaskKind } from '$contract/agent';
import type { EventEnvelope } from './events';
import type { RunId } from './run';

export type BackgroundWork = Readonly<{
	runId: RunId;
	waiting: boolean;
	tasks: readonly AgentBackgroundTask[];
}>;

export type BackgroundWait = 'agents' | 'commands';

type BackgroundUpdate = Extract<EventEnvelope['event'], { type: 'background.updated' }>;

const AGENT_WORK: ReadonlySet<string> = new Set([
	'assistant.message',
	'thinking.message',
	'plan.updated',
	'tool.started',
]);

const KIND_NOUNS: Readonly<Record<AgentBackgroundTaskKind, readonly [string, string]>> = {
	command: ['background command', 'background commands'],
	agent: ['background agent', 'background agents'],
	task: ['background task', 'background tasks'],
};

const NAMES = new Intl.ListFormat('en', { type: 'conjunction' });

export function latestBackgroundWork(
	envelopes: readonly EventEnvelope[],
	live: BackgroundWork | null,
): BackgroundWork | null {
	const handedOff = new Set<RunId>();
	for (let index = envelopes.length - 1; index >= 0; index -= 1) {
		const envelope = envelopes[index];
		if (!envelope) continue;
		const { runId, event } = envelope;
		if (
			event.type !== 'background.updated' &&
			event.type !== 'run.completed' &&
			event.type !== 'run.failed'
		) {
			continue;
		}
		if (event.handedOff) {
			handedOff.add(runId);
			continue;
		}
		if (event.type !== 'background.updated') return null;
		const work =
			live?.runId === runId ? live : { runId, waiting: event.waiting, tasks: event.tasks };
		if (work.tasks.length === 0) return null;
		return handedOff.has(runId) ? { ...work, waiting: false } : work;
	}
	return null;
}

export function backgroundWaitOf(
	work: Pick<BackgroundWork, 'waiting' | 'tasks'> | null,
): BackgroundWait | null {
	if (!work?.waiting || work.tasks.length === 0) return null;
	return work.tasks.every((task) => task.kind === 'command') ? 'commands' : 'agents';
}

export function replyOverCommands(
	update: Pick<BackgroundUpdate, 'waiting' | 'tasks' | 'summary'>,
): string | null {
	return backgroundWaitOf(update) === 'commands' ? (update.summary ?? null) : null;
}

export function resumesTurn(event: Readonly<{ type: string }>): boolean {
	return AGENT_WORK.has(event.type);
}

export function backgroundWorkSummary(tasks: readonly AgentBackgroundTask[]): string {
	const kinds = new Set(tasks.map((task) => task.kind));
	const [kind] = kinds;
	const [one, many] = KIND_NOUNS[kinds.size === 1 && kind ? kind : 'task'];
	return `${tasks.length} ${tasks.length === 1 ? one : many}`;
}

export function backgroundCommandsPhrase(commands: readonly string[]): string {
	const [one, many] = KIND_NOUNS.command;
	if (commands.length === 0) return `a ${one}`;
	const names = NAMES.format(commands.map((command) => `“${command}”`));
	return `its ${commands.length === 1 ? one : many} ${names}`;
}

export function backgroundTaskElapsed(startedAt: number, nowMs: number): string {
	const seconds = Math.max(0, Math.floor((nowMs - startedAt) / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
