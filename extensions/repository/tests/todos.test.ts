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

test('blocks merge on open or unreadable todos and supports explicit local recovery', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'todo-merge-gate',
			branch: 'feature/todos',
			baseBranch: 'main',
			files: { 'README.md': 'todos' },
		},
		repository: {
			pullRequest: {
				state: 'open',
				number: 42,
				title: 'Todo gate',
				url: 'https://example.test/pull/42',
				baseBranch: 'main',
				headBranch: 'feature/todos',
				headSha: 'abc123',
				checks: 'success',
				mergeable: true,
				mergeableState: 'clean',
				viewerCanMerge: true,
				allowedMergeMethods: ['squash'],
				defaultMergeMethod: 'squash',
				reviewDecision: 'approved',
				unresolvedReviewThreadCount: 0,
			},
		},
	});
	try {
		await host.activate(extension);
		await host.invokeCommand('malini.repository.todo-add', 'Close the loop');
		await assert.rejects(
			host.invokeCommand('malini.repository.request-merge-confirmation'),
			/open workstream todo/u,
		);
		await host.deactivate();

		await host.api.state.set(
			REPOSITORY_TODO_STATE_KEY,
			{ version: 1, todos: [{ id: 'bad id', text: 'broken', completed: false, createdAt: 1 }] },
			{ kind: 'workstream', id: host.workstream.id },
		);
		const controller = new RepositoryController(host.api);
		let state = await controller.loadTodos();
		assert.equal(state.todoStatus, 'error');
		assert.match(state.todoError ?? '', /unreadable/u);
		await assert.rejects(controller.requestMergeConfirmation(), /todos are unreadable/u);

		state = await controller.resetTodos();
		assert.equal(state.todoStatus, 'ready');
		assert.deepEqual(state.todos, []);
		assert.equal(
			await host.api.state.get(REPOSITORY_TODO_STATE_KEY, {
				kind: 'workstream',
				id: host.workstream.id,
			}),
			null,
		);
		controller.dispose();
	} finally {
		await host.cleanup();
	}
});

test('actual merge reloads persisted todos instead of trusting stale ready state', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'todo-stale-merge-gate',
			branch: 'feature/todos',
			baseBranch: 'main',
			files: { 'README.md': 'todos' },
		},
		repository: {
			supportsPullRequestMutations: true,
			pullRequest: mergeReadyPullRequest(),
		},
	});
	const controller = new RepositoryController(host.api);
	try {
		let state = await controller.loadTodos();
		assert.equal(state.todoStatus, 'ready');
		assert.deepEqual(state.todos, []);

		await host.api.state.set(
			REPOSITORY_TODO_STATE_KEY,
			{
				version: 1,
				todos: [
					{
						id: 'todo:external',
						text: 'Added outside this controller',
						completed: false,
						createdAt: 2,
					},
				],
			},
			{ kind: 'workstream', id: host.workstream.id },
		);

		await assert.rejects(controller.mergePullRequest(undefined, 'abc123'), /open workstream todo/u);
		state = controller.snapshot();
		assert.equal(state.todoStatus, 'ready');
		assert.equal(state.todos[0]?.id, 'todo:external');
		assert.equal(
			host.recording().some(({ kind }) => kind === 'repository.mergePullRequest'),
			false,
		);
	} finally {
		controller.dispose();
		await host.cleanup();
	}
});

test('merge confirmation waits for a queued todo write and then observes its blocker', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'todo-queued-merge-gate',
			branch: 'feature/todos',
			baseBranch: 'main',
			files: { 'README.md': 'todos' },
		},
		repository: {
			pullRequest: mergeReadyPullRequest(),
		},
	});
	let releaseSave: () => void = () => undefined;
	const saveGate = new Promise<void>((resolve) => {
		releaseSave = resolve;
	});
	let announceSave: () => void = () => undefined;
	const saveStarted = new Promise<void>((resolve) => {
		announceSave = resolve;
	});
	let delayed = false;
	const api = {
		...host.api,
		state: {
			...host.api.state,
			set: async <T>(
				key: string,
				value: T,
				scope?: Parameters<(typeof host.api.state)['set']>[2],
			) => {
				if (!delayed && key === REPOSITORY_TODO_STATE_KEY) {
					delayed = true;
					announceSave();
					await saveGate;
				}
				await host.api.state.set(key, value, scope);
			},
		},
	} satisfies typeof host.api;
	const controller = new RepositoryController(api);
	try {
		await controller.loadTodos();
		const add = controller.addTodo('Queued blocker');
		await saveStarted;

		let confirmationSettled = false;
		const confirmation = controller.requestMergeConfirmation();
		void confirmation
			.catch(() => undefined)
			.finally(() => {
				confirmationSettled = true;
			});
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(confirmationSettled, false);

		releaseSave();
		await add;
		await assert.rejects(confirmation, /open workstream todo/u);
		assert.equal(controller.snapshot().mergeConfirmationRequest, null);
	} finally {
		releaseSave();
		controller.dispose();
		await host.cleanup();
	}
});

function mergeReadyPullRequest() {
	return {
		state: 'open' as const,
		number: 42,
		title: 'Todo gate',
		url: 'https://example.test/pull/42',
		baseBranch: 'main',
		headBranch: 'feature/todos',
		headSha: 'abc123',
		checks: 'success' as const,
		mergeable: true,
		mergeableState: 'clean' as const,
		viewerCanMerge: true,
		allowedMergeMethods: ['squash'] as const,
		defaultMergeMethod: 'squash' as const,
		reviewDecision: 'approved' as const,
		unresolvedReviewThreadCount: 0,
	};
}
