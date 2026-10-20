import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { GhError, GitError } from '../errors';
import { CommandRegistry, type FailedCommand } from './registry';

describe('CommandRegistry', () => {
	it('returns the handler value, and null for void handlers', async () => {
		const registry = new CommandRegistry();
		registry.define('chat.reset-workstream-runs', () => 42);
		registry.define('app.focus-window', () => undefined);
		expect(await registry.invoke({ command: 'chat.reset-workstream-runs', args: {} })).toEqual({
			ok: true,
			value: 42,
		});
		expect(await registry.invoke({ command: 'app.focus-window', args: {} })).toEqual({
			ok: true,
			value: null,
		});
	});

	it('turns a thrown Error or string into a plain string error', async () => {
		const registry = new CommandRegistry();
		registry.define('app.destroy-window', () => {
			throw new Error('boom');
		});
		registry.define('chat.restart-agent', () => Promise.reject('plain'));
		expect(await registry.invoke({ command: 'app.destroy-window', args: {} })).toEqual({
			ok: false,
			error: 'boom',
		});
		expect(await registry.invoke({ command: 'chat.restart-agent', args: {} })).toEqual({
			ok: false,
			error: 'plain',
		});
	});

	it('rejects unknown and duplicate commands', async () => {
		const registry = new CommandRegistry();
		registry.define('chat.reset-workstream-runs', () => 1);
		expect(() => registry.define('chat.reset-workstream-runs', () => 2)).toThrow(
			'already registered',
		);
		expect(await registry.invoke({ command: 'cmd_nope', args: {} })).toEqual({
			ok: false,
			error: 'unknown command "cmd_nope"',
		});
	});

	it('replies with the name, code, kind and command of what the handler threw', async () => {
		const registry = new CommandRegistry();
		registry.define('repositories.archive-workstream', () => {
			throw GitError.io('EACCES: permission denied, rename', 'EACCES');
		});
		registry.define('pull-requests.merge', () => {
			throw GhError.fromStderr('gh: not logged in to github.com', 4);
		});
		registry.define('app.destroy-window', () => {
			throw new Error('');
		});

		expect(await registry.handle({ command: 'repositories.archive-workstream', args: {} })).toEqual(
			{
				ok: false,
				failure: {
					name: 'GitError',
					message: 'io error: EACCES: permission denied, rename',
					code: 'EACCES',
					kind: 'io',
					command: 'repositories.archive-workstream',
				},
			},
		);
		expect(await registry.handle({ command: 'pull-requests.merge', args: {} })).toEqual({
			ok: false,
			failure: {
				name: 'GhError',
				message: 'not logged in to github.com',
				code: null,
				kind: 'auth-required',
				command: 'pull-requests.merge',
			},
		});
		expect(await registry.handle({ command: 'app.destroy-window', args: {} })).toMatchObject({
			failure: {
				name: 'Error',
				message: 'app.destroy-window failed and gave no reason: the handler threw an empty Error',
			},
		});
	});

	it('tells every failure observer what failed, with the raw error and how long it took', async () => {
		const registry = new CommandRegistry();
		const cause = GitError.worktreeBusy('locked');
		registry.define('repositories.archive-workstream', async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			throw cause;
		});
		registry.define('app.focus-window', () => undefined);
		const failed: FailedCommand[] = [];
		const stop = registry.observeFailures((entry) => failed.push(entry));
		registry.observeFailures(() => {
			throw new Error('a broken observer');
		});

		await registry.invoke({ command: 'app.focus-window', args: {} });
		const reply = await registry.invoke({
			command: 'repositories.archive-workstream',
			args: { workstreamId: 'ws-1' },
		});
		stop();
		await registry.invoke({ command: 'repositories.archive-workstream', args: {} });

		expect(reply).toEqual({ ok: false, error: 'worktree busy: locked' });
		expect(failed).toHaveLength(1);
		expect(failed[0]).toMatchObject({
			command: 'repositories.archive-workstream',
			args: { workstreamId: 'ws-1' },
			failure: { name: 'GitError', kind: 'worktree-busy' },
		});
		expect(failed[0]?.error).toBe(cause);
		expect(failed[0]?.durationMs).toBeGreaterThanOrEqual(15);
	});
});
