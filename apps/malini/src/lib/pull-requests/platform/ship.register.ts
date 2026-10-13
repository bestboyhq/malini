import type { MainContext } from '$main/context';
import type { PullRequestsPlatform } from '../pull-requests.platform';
import { requireString } from './args';
import {
	MergeQueue,
	type MergeQueueOptions,
	type PullRequestOperations,
} from './merge-queue.service';

const TERMINAL_RUN_EVENTS = new Set(['run.completed', 'run.failed']);

export function registerShip(
	context: MainContext,
	operations: PullRequestOperations,
	options: MergeQueueOptions = {},
): PullRequestsPlatform {
	const { commands, events } = context;
	const queue = new MergeQueue(context, operations, options);
	const workstreamId = (args: unknown): string => requireString(args, 'workstreamId');

	commands.define('pull-requests.open-draft', (args: unknown) =>
		queue.openDraft(workstreamId(args)),
	);
	commands.define('pull-requests.queue-merge', (args: unknown) =>
		queue.queueMerge(workstreamId(args)),
	);
	commands.define('pull-requests.cancel-merge', (args: unknown) =>
		queue.cancelMerge(workstreamId(args)),
	);
	commands.define('pull-requests.retry-merge', (args: unknown) =>
		queue.retryMerge(workstreamId(args)),
	);
	commands.define('pull-requests.ship-states', () => queue.states());

	const subscriptions = [
		events.subscribe('chat:agent-event', (envelope) => {
			if (envelope.ephemeral || !TERMINAL_RUN_EVENTS.has(String(envelope.event['type']))) return;
			queue.agentRunEnded(envelope.runId);
		}),
		events.subscribe('jobs:run-changed', ({ run }) => queue.jobChanged(run)),
		events.subscribe('repositories:workstream-removed', (removed) =>
			queue.workstreamRemoved(removed.workstreamId),
		),
	];

	return {
		start: () => queue.start(),
		dispose: () => {
			for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
			queue.dispose();
		},
	};
}
