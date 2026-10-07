import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chat,
	openPromptPipeline,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { cancelRunCommand } from '$lib/chat/application/commands/cancel-run.command';
import { sessionStatusQuery } from '$lib/chat/application/queries/session-status.query.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';

afterEach(async () => {
	await resetPromptPipeline();
});

describe('cancelling the active run', () => {
	it('stops the run of the open chat and leaves it idle, not failed', async () => {
		await openPromptPipeline([chat('s-a1', { status: 'running', currentRunId: 'run-1' })]);
		chatSessionStore.sessionId = 's-a1';
		expect(sessionStatusQuery.data).toBe('running');

		cancelRunCommand();

		await vi.waitFor(() => expect(sessionStatusQuery.data).toBe('idle'));
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('stays quiet when the run already finished', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1', { status: 'running' })]);
		chatSessionStore.sessionId = 's-a1';
		const cancel = vi.fn(async () => {
			throw new Error('cancel race: run already completed');
		});
		platform.define('chat.cancel-run', cancel);
		const warning = vi.spyOn(toast, 'warning');

		cancelRunCommand();

		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve));
		expect(warning).not.toHaveBeenCalled();
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('surfaces any other failure as a session error', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1', { status: 'running' })]);
		chatSessionStore.sessionId = 's-a1';
		platform.define('chat.cancel-run', async () => {
			throw new Error('bridge unreachable');
		});

		cancelRunCommand();

		await vi.waitFor(() => expect(chatSessionStore.bootError).toBe('bridge unreachable'));
	});
});
