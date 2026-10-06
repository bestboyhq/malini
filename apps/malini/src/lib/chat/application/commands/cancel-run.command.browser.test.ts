import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	WORKSTREAM,
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

		cancelRunCommand(WORKSTREAM);

		await vi.waitFor(() => expect(sessionStatusQuery.data).toBe('idle'));
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('tells the user when the run already finished', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1', { status: 'running' })]);
		chatSessionStore.sessionId = 's-a1';
		platform.define('chat.cancel-run', async () => {
			throw new Error('cancel race: run already completed');
		});
		const warning = vi.spyOn(toast, 'warning');

		cancelRunCommand(WORKSTREAM);

		await vi.waitFor(() =>
			expect(warning).toHaveBeenCalledWith('Run already finished · nothing to cancel', {
				context: { workstream: WORKSTREAM },
			}),
		);
		expect(chatSessionStore.bootError).toBeNull();
	});

	it('surfaces any other failure as a session error', async () => {
		const { platform } = await openPromptPipeline([chat('s-a1', { status: 'running' })]);
		chatSessionStore.sessionId = 's-a1';
		platform.define('chat.cancel-run', async () => {
			throw new Error('bridge unreachable');
		});

		cancelRunCommand(WORKSTREAM);

		await vi.waitFor(() => expect(chatSessionStore.bootError).toBe('bridge unreachable'));
	});
});
