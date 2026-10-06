import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionFileDiffRequest } from '$lib/chat/domain/session-file-diff';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';
import { AgentSessionFileDiffExtensionTarget } from './agent-session-file-diff-target.service';

function withResolvers<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const disconnects: Array<() => void> = [];

function connect(
	execute: (...args: readonly unknown[]) => Promise<unknown>,
	workstreamId: string,
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

const request: AgentSessionFileDiffRequest = {
	sessionId: 'session-1',
	path: 'src/app.ts',
	additions: 1,
	deletions: 0,
	isBinary: false,
	contributingRunIds: ['run-1'],
	net: {
		beforeCommit: 'before-1',
		afterCommit: 'after-1',
		capturedAt: '2026-07-22T08:00:00Z',
		patch: '@@ -1 +1 @@\n-old\n+new',
	},
	turns: [],
};

afterEach(() => {
	for (const disconnect of disconnects.splice(0)) disconnect();
	inspectorPanelCommands.reset();
});

describe('AgentSessionFileDiffExtensionTarget', () => {
	it('does not open Files when the chat changes during extension command execution', async () => {
		const pendingCommand = withResolvers<unknown>();
		const executeCommand = vi.fn(() => pendingCommand.promise);
		connect(executeCommand, 'workstream-1');
		const target = new AgentSessionFileDiffExtensionTarget();
		const controller = new AbortController();

		const opening = target.open('workstream-1', request, controller.signal);
		await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledOnce());
		controller.abort();
		pendingCommand.resolve(undefined);
		await opening;

		expect(inspectorPanelCommands.requestFor('workstream-1')).toBeNull();
	});

	it('rejects a stale workstream before mutating the active repository controller', async () => {
		const executeCommand = vi.fn(async () => undefined);
		connect(executeCommand, 'workstream-2');
		const target = new AgentSessionFileDiffExtensionTarget();

		await expect(
			target.open('workstream-1', request, new AbortController().signal),
		).rejects.toThrow('not active for this workstream');
		expect(executeCommand).not.toHaveBeenCalled();
		expect(inspectorPanelCommands.requestFor('workstream-1')).toBeNull();
	});
});
