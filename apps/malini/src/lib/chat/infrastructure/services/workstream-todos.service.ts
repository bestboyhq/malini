import type { RepositoryTodosSnapshot } from '@malini-extension/repository';
import type { WorkstreamTodos } from '$lib/chat/domain/workstream-todos';
import { WorkstreamTodosMapper } from '$lib/chat/infrastructure/mappers/workstream-todos.mapper';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';

const REPOSITORY_TODOS_COMMAND = 'malini.repository.todos';

class WorkstreamTodosService {
	async load(workstreamId: string): Promise<WorkstreamTodos> {
		if (!extensionCommands.isReadyFor(workstreamId)) {
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

export const workstreamTodos = new WorkstreamTodosService();
