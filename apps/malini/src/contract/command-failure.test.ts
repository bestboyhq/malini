import { describe, expect, it } from 'vitest';
import { CommandError, commandRejection } from './command-failure';

describe('a command the preload rejected', () => {
	it('becomes a CommandError that keeps the wire failure', () => {
		const error = commandRejection('repositories.workstream-status', {
			name: 'GitError',
			message: 'worktree busy: locked',
			code: null,
			kind: 'worktree-busy',
			command: 'repositories.archive-workstream',
		});

		expect(error).toBeInstanceOf(CommandError);
		expect(error).toMatchObject({
			name: 'GitError',
			message: 'worktree busy: locked',
			kind: 'worktree-busy',
			command: 'repositories.archive-workstream',
		});
	});

	it('names the command when the rejection is plain text or nothing at all', () => {
		expect(commandRejection('repositories.workstream-status', 'scope mismatch')).toMatchObject({
			name: 'Error',
			message: 'scope mismatch',
			command: 'repositories.workstream-status',
		});
		for (const nothing of [undefined, '  ', {}]) {
			expect(commandRejection('app.focus-window', nothing)).toMatchObject({
				message: 'app.focus-window failed and gave no reason',
				command: 'app.focus-window',
			});
		}
	});

	it('passes an Error through untouched', () => {
		const cause = new Error('network is unreachable');
		expect(commandRejection('app.focus-window', cause)).toBe(cause);
	});
});
