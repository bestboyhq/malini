import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkstreamTodosResolutionCommand } from '$lib/chat/application/commands/clear-workstream-todos-resolution.command';
import { resolveWorkstreamTodosCommand } from '$lib/chat/application/commands/resolve-workstream-todos.command';
import { workstreamTodosResolutionQuery } from '$lib/chat/application/queries/workstream-todos-resolution.query.svelte';
import type { WorkstreamTodos } from '$lib/chat/domain/workstream-todos';
import { workstreamTodos } from '$lib/chat/infrastructure/services/workstream-todos.service';
import { workstreamTodosResolutionStore } from '$lib/chat/infrastructure/stores/workstream-todos-resolution.store.svelte';

const TODOS: WorkstreamTodos = {
	workstreamId: 'workstream-1',
	todos: [{ text: 'Ship the fix', completed: false }],
	maxPersistedBytes: 32 * 1_024,
};

function holdTodos(): {
	calls: () => number;
	resolve(todos: WorkstreamTodos): void;
	fail(error: Error): void;
} {
	let resolve: (todos: WorkstreamTodos) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const load = vi.spyOn(workstreamTodos, 'load').mockImplementation(
		() =>
			new Promise<WorkstreamTodos>((nextResolve, nextReject) => {
				resolve = nextResolve;
				reject = nextReject;
			}),
	);
	return {
		calls: () => load.mock.calls.length,
		resolve: (todos) => resolve(todos),
		fail: (error) => reject(error),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	workstreamTodosResolutionStore.reset();
});

describe('resolving @todos before a prompt is sent', () => {
	it('holds one resolution at a time and ignores a duplicate Enter while it runs', async () => {
		const todos = holdTodos();

		resolveWorkstreamTodosCommand({
			requestId: 'first',
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
		});
		resolveWorkstreamTodosCommand({
			requestId: 'duplicate',
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
		});

		expect(todos.calls()).toBe(1);
		expect(workstreamTodosResolutionQuery.data).toEqual({
			requestId: 'first',
			status: 'resolving',
		});

		todos.resolve(TODOS);
		await vi.waitFor(() => expect(workstreamTodosResolutionQuery.data?.status).toBe('resolved'));
		const resolution = workstreamTodosResolutionQuery.data;
		expect(resolution?.requestId).toBe('first');
		expect(resolution?.status === 'resolved' ? resolution.prompt : '').toContain(
			'1. [open] "Ship the fix"',
		);
	});

	it('reports why the todos could not load, and frees the gate for the next attempt', async () => {
		const todos = holdTodos();

		resolveWorkstreamTodosCommand({
			requestId: 'first',
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
		});
		todos.fail(new Error('Workstream todos are not ready yet'));

		await vi.waitFor(() =>
			expect(workstreamTodosResolutionQuery.data).toEqual({
				requestId: 'first',
				status: 'failed',
				error: 'Workstream todos are not ready yet',
			}),
		);

		resolveWorkstreamTodosCommand({
			requestId: 'second',
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
		});
		expect(todos.calls()).toBe(2);
	});

	it('forgets a settled resolution once the composer has consumed it', async () => {
		const todos = holdTodos();
		resolveWorkstreamTodosCommand({
			requestId: 'first',
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
		});
		todos.resolve(TODOS);
		await vi.waitFor(() => expect(workstreamTodosResolutionQuery.data?.status).toBe('resolved'));

		clearWorkstreamTodosResolutionCommand('someone-else');
		expect(workstreamTodosResolutionQuery.data?.requestId).toBe('first');

		clearWorkstreamTodosResolutionCommand('first');
		expect(workstreamTodosResolutionQuery.data).toBeNull();
	});
});
