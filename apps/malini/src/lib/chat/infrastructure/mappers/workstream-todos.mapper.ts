import {
	REPOSITORY_TODO_LIMITS,
	type RepositoryTodosSnapshot as RawWorkstreamTodos,
} from '@malini-extension/repository';
import type { WorkstreamTodos } from '$lib/chat/domain/workstream-todos';

export class WorkstreamTodosMapper {
	static fromRaw(raw: RawWorkstreamTodos): WorkstreamTodos {
		return {
			workstreamId: raw.workstreamId,
			todos: raw.todos.map((todo) => ({ text: todo.text, completed: todo.completed })),
			maxPersistedBytes: REPOSITORY_TODO_LIMITS.maxPersistedBytes,
		};
	}
}
