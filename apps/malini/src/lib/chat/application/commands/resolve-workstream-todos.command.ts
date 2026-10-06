import { errorMessage } from '$lib/chat/domain/error-message';
import { promptWithWorkstreamTodos } from '$lib/chat/domain/workstream-todos';
import { workstreamTodos } from '$lib/chat/infrastructure/services/workstream-todos.service';
import { workstreamTodosResolutionStore } from '$lib/chat/infrastructure/stores/workstream-todos-resolution.store.svelte';

export { resolveWorkstreamTodosCommand };

function resolveWorkstreamTodosCommand(
	input: Readonly<{ requestId: string; workstreamId: string; prompt: string }>,
): void {
	if (workstreamTodosResolutionStore.resolving) return;
	workstreamTodosResolutionStore.resolution = { requestId: input.requestId, status: 'resolving' };
	void (async () => {
		try {
			const todos = await workstreamTodos.load(input.workstreamId);
			workstreamTodosResolutionStore.settle({
				requestId: input.requestId,
				status: 'resolved',
				prompt: promptWithWorkstreamTodos(input.prompt, todos),
			});
		} catch (error) {
			workstreamTodosResolutionStore.settle({
				requestId: input.requestId,
				status: 'failed',
				error: errorMessage(error, 'Could not load workstream todos'),
			});
		}
	})();
}
