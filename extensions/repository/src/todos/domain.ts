export const REPOSITORY_TODO_STATE_KEY = 'workstream-todos.v1';

export const REPOSITORY_TODO_LIMITS = Object.freeze({
	maxItems: 50,
	maxTextCharacters: 240,
	maxTextBytes: 1_024,
	maxIdCharacters: 128,
	maxPersistedBytes: 32 * 1_024,
});

export type RepositoryTodo = Readonly<{
	id: string;
	text: string;
	completed: boolean;
	createdAt: number;
}>;

export type RepositoryTodoEnvelope = Readonly<{
	version: 1;
	todos: readonly RepositoryTodo[];
}>;

export type RepositoryTodoParseResult =
	Readonly<{ ok: true; todos: readonly RepositoryTodo[] }> | Readonly<{ ok: false; error: string }>;

const UNSAFE_TEXT_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const TODO_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u;

export function sanitizeRepositoryTodoText(input: unknown): string {
	if (typeof input !== 'string') throw new Error('Todo text must be a string');
	const text = input
		.normalize('NFKC')
		.replace(UNSAFE_TEXT_CONTROLS, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
	if (!text) throw new Error('Todo text cannot be empty');
	if ([...text].length > REPOSITORY_TODO_LIMITS.maxTextCharacters) {
		throw new Error(
			`Todo text cannot exceed ${REPOSITORY_TODO_LIMITS.maxTextCharacters} characters`,
		);
	}
	if (utf8Bytes(text) > REPOSITORY_TODO_LIMITS.maxTextBytes) {
		throw new Error('Todo text is too large');
	}
	return text;
}

export function repositoryTodoEnvelope(todos: readonly RepositoryTodo[]): RepositoryTodoEnvelope {
	const parsed = parseRepositoryTodoEnvelope({ version: 1, todos });
	if (!parsed.ok) throw new Error(parsed.error);
	return { version: 1, todos: cloneRepositoryTodos(parsed.todos) };
}

export function parseRepositoryTodoEnvelope(input: unknown): RepositoryTodoParseResult {
	if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.todos)) {
		return corrupt('Todo state has an unsupported format');
	}
	if (input.todos.length > REPOSITORY_TODO_LIMITS.maxItems) {
		return corrupt(`Todo state exceeds the ${REPOSITORY_TODO_LIMITS.maxItems} item limit`);
	}
	try {
		if (utf8Bytes(JSON.stringify(input)) > REPOSITORY_TODO_LIMITS.maxPersistedBytes) {
			return corrupt('Todo state is too large');
		}
	} catch {
		return corrupt('Todo state could not be read');
	}

	const ids = new Set<string>();
	const todos: RepositoryTodo[] = [];
	for (const value of input.todos) {
		if (!isRecord(value)) return corrupt('Todo state contains an invalid item');
		const { id, text, completed, createdAt } = value;
		if (
			typeof id !== 'string' ||
			id.length === 0 ||
			id.length > REPOSITORY_TODO_LIMITS.maxIdCharacters ||
			!TODO_ID.test(id) ||
			ids.has(id)
		) {
			return corrupt('Todo state contains an invalid or duplicate id');
		}
		if (typeof completed !== 'boolean') {
			return corrupt('Todo state contains an invalid completion value');
		}
		if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0) {
			return corrupt('Todo state contains an invalid creation time');
		}
		let normalizedText: string;
		try {
			normalizedText = sanitizeRepositoryTodoText(text);
		} catch (error) {
			return corrupt(error instanceof Error ? error.message : 'Todo state contains invalid text');
		}
		if (normalizedText !== text) {
			return corrupt('Todo state contains unsanitized text');
		}
		ids.add(id);
		todos.push({ id, text: normalizedText, completed, createdAt: createdAt as number });
	}
	return { ok: true, todos };
}

export function cloneRepositoryTodos(todos: readonly RepositoryTodo[]): RepositoryTodo[] {
	return todos.map((todo) => ({ ...todo }));
}

export function repositoryTodoOpenCount(todos: readonly RepositoryTodo[]): number {
	return todos.reduce((count, todo) => count + (todo.completed ? 0 : 1), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function corrupt(error: string): RepositoryTodoParseResult {
	return { ok: false, error };
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
