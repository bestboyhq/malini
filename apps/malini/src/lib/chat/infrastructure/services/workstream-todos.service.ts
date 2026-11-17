import type { RepositoryTodosSnapshot } from '@malini-extension/repository';
import type { WorkstreamTodos } from '$lib/chat/domain/workstream-todos';
import { WorkstreamTodosMapper } from '$lib/chat/infrastructure/mappers/workstream-todos.mapper';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';

const REPOSITORY_TODOS_COMMAND = 'malini.repository.todos';
const EXTENSIONS_READY_WAIT_MS = 15_000;
const EXTENSIONS_READY_POLL_MS = 100;

class WorkstreamTodosService {
	async load(workstreamId: string): Promise<WorkstreamTodos> {
		if (!(await extensionsReadyFor(workstreamId))) {
			throw new Error('Workstream todos are not ready yet');
		}
		const snapshot = await extensionCommands.execute<RepositoryTodosSnapshot>(
			workstreamId,
			REPOSITORY_TODOS_COMMAND,
		);
		if (snapshot.workstreamId !== workstreamId) {
			throw new Error('Workstream todo context changed while it was loading');
		}
		return WorkstreamTodosMapper.fromRaw(snapshot);
	}
}

// ponytail: polls because extension readiness is not reactive; await a readiness signal from the extension runtime once one exists
async function extensionsReadyFor(workstreamId: string): Promise<boolean> {
	const deadline = performance.now() + EXTENSIONS_READY_WAIT_MS;
	while (!extensionCommands.isReadyFor(workstreamId)) {
		if (performance.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, EXTENSIONS_READY_POLL_MS));
	}
	return true;
}

export const workstreamTodos = new WorkstreamTodosService();
