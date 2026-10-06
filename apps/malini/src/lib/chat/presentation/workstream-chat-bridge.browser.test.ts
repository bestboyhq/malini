import { flushSync, mount, unmount } from 'svelte';
import type { PullRequestActionInput } from '@malini-extension/repository';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateChatRoute } from '$lib/chat/application/chat-route.testkit.svelte';
import {
	WORKSTREAM,
	chat,
	holdPromptDelivery,
	openPromptPipeline,
	rememberChatTurn,
	resetPromptPipeline,
} from '$lib/chat/application/prompt-pipeline.testkit';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import WorkstreamChatBridgeHarness from './fixtures/WorkstreamChatBridgeHarness.svelte';

type Seams = Readonly<{
	submitAutomatedPrompt(prompt: string): Promise<void>;
	chatEvidence(): PullRequestActionInput;
}>;

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	await resetPromptPipeline();
});

function bridge(): Seams {
	const host = document.createElement('div');
	document.body.append(host);
	let seams: Seams | null = null;
	const app = mount(WorkstreamChatBridgeHarness, {
		target: host,
		props: { workstreamId: WORKSTREAM, onseams: (next: Seams) => (seams = next) },
	});
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
	};
	if (!seams) throw new Error('The chat bridge exposed no seams');
	return seams;
}

async function openChat(): Promise<ReturnType<typeof holdPromptDelivery>> {
	await openPromptPipeline(
		[chat('s-a1'), chat('s-newer', { startedAt: '2026-02-01T00:00:00.000Z' })],
		{
			agentEvents: {
				's-a1': [
					{ runId: 'run-1', event: { type: 'user.message', text: 'Add a health endpoint' } },
					{ runId: 'run-1', event: { type: 'file.changed', path: 'src/health.ts' } },
					{
						runId: 'run-1',
						event: { type: 'run.completed', summary: 'Added the /health endpoint' },
					},
				],
				's-newer': [{ runId: 'run-2', event: { type: 'user.message', text: 'Something newer' } }],
			},
		},
	);
	rememberChatTurn('s-a1');
	await sessionActivation.hydrate('s-a1');
	chatSessionStore.sessionId = 's-a1';
	return holdPromptDelivery();
}

describe('the chat seam the pull-request actions use', () => {
	it('settles a prompt only once the chat has accepted it', async () => {
		const delivery = await openChat();
		chatModelStore.profile = { mode: 'agent', effort: 'high', access: 'sandboxed' };
		const { submitAutomatedPrompt } = bridge();
		let settled = false;

		const submitted = submitAutomatedPrompt('Fix the failing checks');
		void (async () => {
			await submitted;
			settled = true;
		})();

		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(settled).toBe(false);
		expect(delivery.calls()[0]).toMatchObject({
			sessionId: 's-a1',
			prompt: 'Fix the failing checks',
			profile: { mode: 'agent', effort: 'high', access: 'sandboxed' },
			automated: true,
		});

		delivery.release();
		await expect(submitted).resolves.toBeUndefined();
		expect(settled).toBe(true);
	});

	it('rejects with the chat’s own reason when the prompt is refused', async () => {
		const delivery = await openChat();
		const { submitAutomatedPrompt } = bridge();

		const submitted = submitAutomatedPrompt('Fix the failing checks');
		await vi.waitFor(() => expect(delivery.calls()).toHaveLength(1));
		delivery.fail(new Error('provider exploded'));

		await expect(submitted).rejects.toThrow('provider exploded');
	});

	it('hands over the evidence of the chat named in the route', async () => {
		await openChat();
		await sessionActivation.hydrate('s-newer');
		await navigateChatRoute(`/workstreams/${WORKSTREAM}?agent=s-a1`);
		const { chatEvidence } = bridge();

		expect(chatEvidence()).toEqual({
			context: {
				sessionTitle: 's-a1',
				lastUserIntent: 'Add a health endpoint',
				runSummaries: ['Added the /health endpoint'],
			},
			changedPaths: ['src/health.ts'],
		});
	});
});
