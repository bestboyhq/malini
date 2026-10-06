import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitComposerPromptCommand } from '$lib/chat/application/commands/submit-composer-prompt.command';
import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
import {
	WORKSTREAM,
	chat,
	holdPromptDelivery,
	openPromptPipeline,
	rememberChatTurn,
	resetPromptPipeline,
	submission,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
import { composerDraftRestorationQuery } from '$lib/chat/application/queries/composer-draft-restoration.query.svelte';
import { composerPendingSubmissionsQuery } from '$lib/chat/application/queries/composer-pending-submissions.query.svelte';
import { newChatRequestId } from '$lib/chat/domain/chat-request';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import type { PromptSubmission } from '$lib/chat/domain/prompt-submission';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const SCOPE = agentDraftScopeKey(WORKSTREAM, 's-a1');

afterEach(async () => {
	await resetPromptPipeline();
});

async function openChat(): Promise<ReturnType<typeof holdPromptDelivery>> {
	await openPromptPipeline([chat('s-a1')]);
	rememberChatTurn('s-a1');
	chatSessionStore.sessionId = 's-a1';
	updateDraftCommand(SCOPE, { text: '', contextFiles: [] });
	return holdPromptDelivery();
}

function send(prompt: string, overrides: Partial<PromptSubmission> = {}): string {
	const requestId = newChatRequestId();
	submitComposerPromptCommand({
		draftScope: SCOPE,
		draftPrompt: prompt,
		freshIntentKey: `${WORKSTREAM}:agent:model`,
		request: {
			...submission({ sessionId: 's-a1', prompt, contextFiles: [`${prompt}.ts`], ...overrides }),
			requestId,
		},
	});
	return requestId;
}

describe('sending a prompt from the composer', () => {
	it('delivers composer prompts one at a time, in order', async () => {
		const delivery = await openChat();

		send('first');
		send('second');

		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		expect(composerPendingSubmissionsQuery.data).toBe(2);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(delivery.calls().map((call) => call.prompt)).toEqual(['first']);

		delivery.release();
		await vi.waitFor(() => expect(composerPendingSubmissionsQuery.data).toBe(0));
		expect(delivery.calls().map((call) => call.prompt)).toEqual(['first', 'second']);
	});

	it('puts a rejected prompt back into its draft, after anything typed since, and says so', async () => {
		const delivery = await openChat();

		const requestId = send('Ship the fix');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		updateDraftCommand(SCOPE, { text: 'typed meanwhile' });
		delivery.fail(new Error('provider exploded'));

		await vi.waitFor(() => expect(composerDraftRestorationQuery.data(SCOPE)).toBe(1));
		expect(chatRequestQuery.data(requestId)).toEqual({
			status: 'failed',
			error: 'provider exploded',
		});
		expect(composerDraftQuery.data(SCOPE)).toMatchObject({
			text: 'Ship the fix\n\ntyped meanwhile',
			contextFiles: ['Ship the fix.ts'],
		});
	});

	it('merges every prompt rejected while the queue was busy into one restored draft', async () => {
		const delivery = await openChat();

		send('first');
		send('second');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		delivery.fail(new Error('provider exploded'));

		await vi.waitFor(() => expect(composerPendingSubmissionsQuery.data).toBe(0));
		expect(composerDraftRestorationQuery.data(SCOPE)).toBe(1);
		expect(composerDraftQuery.data(SCOPE)).toMatchObject({
			text: 'first\n\nsecond',
			contextFiles: ['first.ts', 'second.ts'],
		});
	});

	it('leaves the draft alone when the prompt is accepted', async () => {
		const delivery = await openChat();
		updateDraftCommand(SCOPE, { text: 'next idea' });

		const requestId = send('Ship the fix');
		delivery.release();

		await vi.waitFor(() =>
			expect(chatRequestQuery.data(requestId)).toEqual({ status: 'accepted' }),
		);
		await vi.waitFor(() => expect(composerPendingSubmissionsQuery.data).toBe(0));
		expect(composerDraftRestorationQuery.data(SCOPE)).toBe(0);
		expect(composerDraftQuery.data(SCOPE).text).toBe('next idea');
	});

	it('asks for a fresh chat again after a fresh-chat prompt was rejected', async () => {
		const { platform } = await openPromptPipeline([]);
		platform.define('chat.send-prompt', async () => {
			throw new Error('provider exploded');
		});

		send('fresh one', { sessionId: null, forceFreshSession: true });
		await vi.waitFor(() => expect(composerPendingSubmissionsQuery.data).toBe(0));
		send('fresh two', { sessionId: null, forceFreshSession: true });
		await vi.waitFor(() => expect(composerPendingSubmissionsQuery.data).toBe(0));

		expect(platform.calls.filter((call) => call.command === 'chat.start-session')).toHaveLength(2);
	});
});
