import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import {
	AgentFileMentionExtensionTarget,
	OPEN_REPOSITORY_FILE_COMMAND,
	RepositoryFileTargetUnavailableError,
} from './agent-file-mention-target.service';

const disconnects: Array<() => void> = [];

afterEach(() => {
	for (const disconnect of disconnects.splice(0)) disconnect();
});

function connect(
	execute: (id: string, ...args: readonly unknown[]) => Promise<unknown>,
	workstreamId: string | null = 'workstream-1',
): void {
	disconnects.push(
		extensionCommands.connect({
			workstreamId: () => workstreamId,
			execute,
			emit: async () => undefined,
			onEvent: () => () => undefined,
		}),
	);
}

describe('AgentFileMentionExtensionTarget', () => {
	it('asks the repository to open the path and the line it was given', async () => {
		const execute = vi.fn(async () => undefined);
		connect(execute);
		const target = new AgentFileMentionExtensionTarget();

		await target.open('workstream-1', { path: 'src/app.ts', line: 42 });

		expect(execute).toHaveBeenCalledWith(OPEN_REPOSITORY_FILE_COMMAND, {
			path: 'src/app.ts',
			line: 42,
		});
	});

	it('refuses a workstream the repository extension is not showing', async () => {
		const execute = vi.fn(async () => undefined);
		connect(execute, 'workstream-2');
		const target = new AgentFileMentionExtensionTarget();

		await expect(target.open('workstream-1', { path: 'src/app.ts', line: null })).rejects.toThrow(
			RepositoryFileTargetUnavailableError,
		);
		expect(execute).not.toHaveBeenCalled();
	});

	it('propagates the rejection for a path that is not in the workstream', async () => {
		connect(async () => {
			throw new Error('No such file: src/ghost.ts');
		});
		const target = new AgentFileMentionExtensionTarget();

		await expect(target.open('workstream-1', { path: 'src/ghost.ts', line: null })).rejects.toThrow(
			'No such file',
		);
	});

	it('refuses before the extension runtime has a service at all', async () => {
		const target = new AgentFileMentionExtensionTarget();

		await expect(target.open('workstream-1', { path: 'src/app.ts', line: null })).rejects.toThrow(
			RepositoryFileTargetUnavailableError,
		);
	});
});
