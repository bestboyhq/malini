import { describe, expect, it } from 'vitest';
import {
	promptReferencesWorkstreamTodos,
	promptWithWorkstreamTodos,
	workstreamTodoComposerSnapshotMatches,
	workstreamTodoPromptLimitBytes,
	type WorkstreamTodos,
} from './workstream-todos';

const REPOSITORY_TODO_PERSISTED_BYTES = 32 * 1_024;

describe('workstream todo prompt context', () => {
	it('recognizes a bounded @todos mention without matching email-like text', () => {
		expect(promptReferencesWorkstreamTodos('Please handle @todos next')).toBe(true);
		expect(promptReferencesWorkstreamTodos('@todos')).toBe(true);
		expect(promptReferencesWorkstreamTodos('mail@todos.example')).toBe(false);
		expect(promptReferencesWorkstreamTodos('@todos-extra')).toBe(false);
	});

	it('injects the complete max-item angle-bracket list under the derived cap', () => {
		const snapshot: WorkstreamTodos = {
			workstreamId: 'workstream-1',
			todos: Array.from({ length: 50 }, (_, index) => ({
				text: '<'.repeat(240),
				completed: index % 2 === 0,
			})),
			maxPersistedBytes: REPOSITORY_TODO_PERSISTED_BYTES,
		};
		const result = promptWithWorkstreamTodos('Use @todos', snapshot);
		const context = result.slice(result.indexOf('[BEGIN UNTRUSTED'));

		expect(context).toContain('50. [open]');
		expect(context).toContain('<'.repeat(240));
		expect(new TextEncoder().encode(context).byteLength).toBeLessThanOrEqual(
			workstreamTodoPromptLimitBytes(snapshot),
		);
	});

	it('refuses a todo context larger than the repository cap allows', () => {
		const snapshot: WorkstreamTodos = {
			workstreamId: 'workstream-1',
			todos: [{ text: 'x'.repeat(5_000), completed: false }],
			maxPersistedBytes: 0,
		};
		expect(() => promptWithWorkstreamTodos('Use @todos', snapshot)).toThrow(
			'Workstream todo context is too large to submit safely',
		);
	});

	it('preserves any prompt or context edits made after the immutable capture', () => {
		const captured = {
			workstreamId: 'workstream-1',
			prompt: 'Do @todos',
			contextFiles: ['src/a.ts'],
			attachments: [{ id: 'a' }],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		};
		expect(workstreamTodoComposerSnapshotMatches(captured, captured)).toBe(true);
		expect(
			workstreamTodoComposerSnapshotMatches(
				{ ...captured, prompt: 'Do @todos and keep this newer edit' },
				captured,
			),
		).toBe(false);
		expect(
			workstreamTodoComposerSnapshotMatches(
				{ ...captured, contextFiles: [...captured.contextFiles, 'src/new.ts'] },
				captured,
			),
		).toBe(false);
	});
});
