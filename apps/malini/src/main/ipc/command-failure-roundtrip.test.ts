import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
	const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();
	const exposed = new Map<string, unknown>();
	return {
		handlers,
		exposed,
		module: {
			ipcMain: {
				handle: (channel: string, handler: (event: unknown, request: unknown) => unknown) => {
					handlers.set(channel, handler);
				},
			},
			ipcRenderer: {
				invoke: async (channel: string, request: unknown): Promise<unknown> => {
					const handler = handlers.get(channel);
					if (!handler) throw new Error(`No handler registered for '${channel}'`);
					return structuredClone(await handler({}, structuredClone(request)));
				},
				on: () => undefined,
			},
			contextBridge: {
				exposeInMainWorld: (key: string, api: unknown) => {
					exposed.set(key, api);
				},
			},
			webFrame: { getZoomFactor: () => 1 },
		},
	};
});

vi.mock('electron', () => electron.module);

import { CommandError, commandRejection } from '$contract/command-failure';
import type { CommandArgs, CommandName } from '$contract/commands';
import { retirementFailureMessage } from '$shared/repositories/domain/workstream-retirement';
import { GitError } from '../errors';
import { DISABLED_GIT_HOOKS_CONFIG, runGit } from '../git/run';
import { CommandRegistry } from './registry';

let existingFolder: string;
let unpushedRepo: string;

beforeAll(async () => {
	existingFolder = await mkdtemp(join(tmpdir(), 'malini-command-failure-'));
	unpushedRepo = await mkdtemp(join(tmpdir(), 'malini-unpushed-'));
	await runGit(['init', '-q', unpushedRepo]);
	await runGit([
		'-C',
		unpushedRepo,
		'-c',
		'user.email=e2e@example.com',
		'-c',
		'user.name=e2e',
		'commit',
		'--allow-empty',
		'-qm',
		'seed',
	]);

	const registry = new CommandRegistry();
	registry.define('repositories.archive-workstream', () => {
		throw GitError.worktreeBusy('`ws-7` is checked out in another worktree');
	});
	registry.define('repositories.delete-workstream', async () => {
		await mkdir(existingFolder);
		return { savedWork: null };
	});
	registry.define('repositories.push-workstream', () =>
		runGit([
			'-C',
			unpushedRepo,
			'-c',
			'credential.helper=',
			'-c',
			'credential.helper=!gh auth git-credential',
			'-c',
			'http.proxy=http://127.0.0.1:9',
			'-c',
			DISABLED_GIT_HOOKS_CONFIG,
			'push',
			'--no-verify',
			'https://github.com/e2e/hutch.git',
			'HEAD:refs/heads/malini/e2e-dbg',
		]),
	);
	registry.define('chat.restart-agent', () => {
		throw { reason: 'the agent lease was lost' };
	});
	registry.define('chat.cancel-run', () => {
		throw undefined;
	});
	registry.install();

	await import('../../preload/index');
});

afterAll(async () => {
	await rm(existingFolder, { recursive: true, force: true });
	await rm(unpushedRepo, { recursive: true, force: true });
});

describe('a command failure seen from the renderer', () => {
	it('arrives as the GitError the handler threw, with its kind and the command', async () => {
		const error = await rejectionOf(
			invoke('repositories.archive-workstream', { workstreamId: 'ws-7' }),
		);

		expect(error).toBeInstanceOf(CommandError);
		expect(error).toMatchObject({
			name: 'GitError',
			message: 'worktree busy: `ws-7` is checked out in another worktree',
			kind: 'worktree-busy',
			code: null,
			command: 'repositories.archive-workstream',
		});
		expect(retirementFailureMessage(error)).toBe(
			'worktree busy: `ws-7` is checked out in another worktree',
		);
	});

	it('arrives from a real failed git push as a human message, never as the command git ran', async () => {
		const error = await rejectionOf(
			invoke('repositories.push-workstream', {
				workstreamId: 'e2e-dbg',
				expectedRepositoryFullName: 'e2e/hutch',
			}),
		);

		expect(error).toBeInstanceOf(CommandError);
		expect(error).toMatchObject({
			name: 'GitError',
			kind: 'git',
			message: "Couldn't reach github.com. Check your connection and try again.",
			command: 'repositories.push-workstream',
		});
		if (!(error instanceof CommandError)) throw new Error('expected a CommandError');
		const visible = JSON.stringify({ ...error, message: error.message });
		for (const leak of ['-c credential.helper', 'Some(', 'exit=', unpushedRepo, tmpdir()]) {
			expect(visible).not.toContain(leak);
		}
	});

	it('arrives as the node errno error with its code', async () => {
		const error = await rejectionOf(
			invoke('repositories.delete-workstream', { workstreamId: 'w' }),
		);

		expect(error).toBeInstanceOf(CommandError);
		expect(error).toMatchObject({
			name: 'Error',
			code: 'EEXIST',
			command: 'repositories.delete-workstream',
		});
		expect(retirementFailureMessage(error)).toBe(
			`EEXIST: file already exists, mkdir '${existingFolder}'`,
		);
	});

	it('explains a plain thrown object by its contents', async () => {
		const error = await rejectionOf(invoke('chat.restart-agent', undefined));

		expect(error).toBeInstanceOf(Error);
		expect(retirementFailureMessage(error)).toBe('{"reason":"the agent lease was lost"}');
		expect(error).toMatchObject({ name: 'NonErrorThrown', command: 'chat.restart-agent' });
	});

	it('names the command and what was thrown when the handler gave no reason at all', async () => {
		const error = await rejectionOf(invoke('chat.cancel-run', { sessionId: 's' }));

		expect(error).toBeInstanceOf(Error);
		expect(retirementFailureMessage(error)).toBe(
			'chat.cancel-run failed and gave no reason: the handler threw undefined',
		);
	});
});

async function invoke<Name extends CommandName>(
	command: Name,
	args: CommandArgs<Name>,
): Promise<unknown> {
	const exposed: unknown = electron.exposed.get('malini');
	const invokeCommand: unknown = Reflect.get(Object(exposed), 'invoke');
	if (typeof invokeCommand !== 'function') throw new Error('the preload exposed no invoke');
	try {
		return structuredClone(await invokeCommand(command, args));
	} catch (rejection) {
		throw commandRejection(command, structuredClone(rejection));
	}
}

async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
	try {
		await pending;
	} catch (error) {
		return error;
	}
	throw new Error('the command unexpectedly succeeded');
}
