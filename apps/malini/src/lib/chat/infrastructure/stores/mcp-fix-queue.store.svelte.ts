import {
	nextFixStep,
	type McpFixOutcome,
	type McpFixQueue,
	type McpFixStep,
} from '$lib/chat/domain/mcp-server';

class McpFixQueueStore {
	queue: McpFixQueue | null = $state.raw(null);

	open(workstreamId: string | null, steps: readonly McpFixStep[]): void {
		this.queue = { workstreamId, steps, index: 0 };
	}

	mark(serverName: string, outcome: McpFixOutcome, error: string | null): void {
		const queue = this.queue;
		if (!queue) return;
		const steps = queue.steps.map((step) =>
			step.server.name === serverName ? { ...step, outcome, error } : step,
		);
		this.queue = { ...queue, steps };
	}

	advance(): void {
		const queue = this.queue;
		if (queue) this.queue = { ...queue, index: nextFixStep(queue.steps, queue.index) };
	}

	close(): void {
		this.queue = null;
	}
}

export const mcpFixQueueStore = new McpFixQueueStore();
