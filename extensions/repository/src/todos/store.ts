import type { RepositoryControllerStateHost } from '../controller.js';
import {
	REPOSITORY_TODO_STATE_KEY,
	cloneRepositoryTodos,
	parseRepositoryTodoEnvelope,
	repositoryTodoEnvelope,
	type RepositoryTodo,
} from './domain.js';

export class RepositoryTodoStore {
	readonly #state: RepositoryControllerStateHost;

	constructor(state: RepositoryControllerStateHost) {
		this.#state = state;
	}

	async load(workstreamId: string): Promise<readonly RepositoryTodo[]> {
		const stored = await this.#state.get(REPOSITORY_TODO_STATE_KEY, scope(workstreamId));
		if (stored === null) return [];
		const parsed = parseRepositoryTodoEnvelope(stored);
		if (!parsed.ok) throw new Error(`Stored workstream todos are unreadable: ${parsed.error}`);
		return cloneRepositoryTodos(parsed.todos);
	}

	async save(workstreamId: string, todos: readonly RepositoryTodo[]): Promise<void> {
		await this.#state.set(
			REPOSITORY_TODO_STATE_KEY,
			repositoryTodoEnvelope(todos),
			scope(workstreamId),
		);
	}

	async reset(workstreamId: string): Promise<readonly RepositoryTodo[]> {
		await this.#state.delete(REPOSITORY_TODO_STATE_KEY, scope(workstreamId));
		return this.load(workstreamId);
	}
}

function scope(workstreamId: string) {
	return { kind: 'workstream' as const, id: workstreamId };
}
