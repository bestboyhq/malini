import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestHost } from '@malini/extension-api/test';
import {
	RepositoryController,
	type RepositoryTodosSnapshot,
	type RepositoryViewState,
} from '../src/controller.js';
import extension from '../src/index.js';
import {
	REPOSITORY_TODO_LIMITS,
	REPOSITORY_TODO_STATE_KEY,
	parseRepositoryTodoEnvelope,
	sanitizeRepositoryTodoText,
} from '../src/todos/domain.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

test('sanitizes new todo text and rejects malformed persisted envelopes as a whole', () => {
	assert.equal(sanitizeRepositoryTodoText('  ship\u0000  this\u202e now  '), 'ship this now');
	assert.throws(
		() => sanitizeRepositoryTodoText('x'.repeat(REPOSITORY_TODO_LIMITS.maxTextCharacters + 1)),
		/characters/u,
	);
	assert.deepEqual(
		parseRepositoryTodoEnvelope({
			version: 1,
			todos: [
				{ id: 'todo:1', text: 'one', completed: false, createdAt: 1 },
				{ id: 'todo:1', text: 'two', completed: false, createdAt: 2 },
			],
		}),
		{ ok: false, error: 'Todo state contains an invalid or duplicate id' },
	);
	assert.equal(
		parseRepositoryTodoEnvelope({
			version: 1,
			todos: [{ id: 'todo:1', text: ' line\nbreak ', completed: false, createdAt: 1 }],
		}).ok,
		false,
	);
});

test('persists add, check-off, and remove operations per workstream across reload', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'todo-persistence', files: { 'README.md': 'todos' } },
	});
	try {
		await host.activate(extension);
		let todos = await host.invokeCommand<RepositoryTodosSnapshot>('malini.repository.todos');
		assert.deepEqual(todos.todos, []);

		await host.invokeCommand('malini.repository.todo-add', '  Run\u0000 focused tests  ');
		todos = await host.invokeCommand<RepositoryTodosSnapshot>('malini.repository.todos');
		assert.equal(todos.todos[0]?.text, 'Run focused tests');
		const id = todos.todos[0]?.id;
		assert.ok(id);

		await host.invokeCommand('malini.repository.todo-toggle', { id, completed: true });
		await host.reload();
		todos = await host.invokeCommand<RepositoryTodosSnapshot>('malini.repository.todos');
		assert.equal(todos.todos[0]?.completed, true);

		await host.invokeCommand('malini.repository.todo-remove', id);
		todos = await host.invokeCommand<RepositoryTodosSnapshot>('malini.repository.todos');
		assert.deepEqual(todos.todos, []);
	} finally {
		await host.cleanup();
	}
});

test('a todo refetch holds the previous list until the new one arrives', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'todo-refetch', files: { 'README.md': 'todos' } },
	});
	const controller = new RepositoryController(host.api);
	try {
		await controller.loadTodos();
		await controller.addTodo('Keep me on screen');
		assert.notEqual(controller.snapshot().todosObservedAt, null);

		const published: RepositoryViewState[] = [];
		const subscription = controller.subscribe((state) => published.push(state), {
			emitCurrent: false,
		});
		await controller.loadTodos();
		subscription.dispose();

		const inFlight = published.filter((state) => state.todoStatus === 'loading');
		assert.ok(inFlight.length > 0, 'a refetch still marks itself as running');
		for (const state of inFlight) {
			assert.deepEqual(
				state.todos.map(({ text }) => text),
				['Keep me on screen'],
				'the known-good list survives the fetch that is replacing it',
			);
			assert.notEqual(state.todosObservedAt, null);
		}
		assert.deepEqual(
			published.at(-1)?.todos.map(({ text }) => text),
			['Keep me on screen'],
		);
	} finally {
		controller.dispose();
		await host.cleanup();
	}
});

test('a workstream switch clears todos before the new ones are read', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'todo-workstream-switch', files: { 'README.md': 'todos' } },
	});
	const controller = new RepositoryController(host.api);
	try {
		await controller.loadTodos();
		await controller.addTodo('Belongs to the workstream we are leaving');
		const switched = controller.setWorkstream({
			...host.workstream,
			id: 'workstream-elsewhere',
		});
		assert.deepEqual(switched.todos, []);
		assert.equal(switched.todoStatus, 'loading');
		assert.equal(switched.todosObservedAt, null);
	} finally {
		controller.dispose();
		await host.cleanup();
	}
});

test('reports unreadable persisted todos as an error instead of an empty list', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'todo-unreadable', files: { 'README.md': 'todos' } },
	});
	const controller = new RepositoryController(host.api);
	try {
		await host.api.state.set(
			REPOSITORY_TODO_STATE_KEY,
			{ version: 1, todos: [{ id: 'bad id', text: 'broken', completed: false, createdAt: 1 }] },
			{ kind: 'workstream', id: host.workstream.id },
		);
		const state = await controller.loadTodos();
		assert.equal(state.todoStatus, 'error');
		assert.match(state.todoError ?? '', /unreadable/u);
		assert.throws(() => controller.todosForPrompt(), /unreadable/u);
	} finally {
		controller.dispose();
		await host.cleanup();
	}
});
