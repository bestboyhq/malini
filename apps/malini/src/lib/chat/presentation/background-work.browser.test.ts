import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	openChatRoute,
	resetChatState,
	settleChatRoute,
} from '$lib/chat/application/chat-route.testkit.svelte';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { mountChatSurface } from './chat-surface.harness.svelte';

const WORKSTREAM = 'ws-background';
const E2E = {
	taskId: 'b1',
	kind: 'command',
	description: 'Run the e2e suite',
	startedAt: Date.now() - 125_000,
	detail: '✓ 214 passed',
};

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	vi.restoreAllMocks();
	await resetChatState();
});

async function openChatWaitingOnE2e(): Promise<HTMLElement> {
	await openChatRoute(
		`/workstreams/${WORKSTREAM}`,
		createFakePlatform({
			agentSessions: [
				{ id: 's-bg', workstreamId: WORKSTREAM, status: 'running', currentRunId: 'run-1' },
			],
			agentEvents: {
				's-bg': [
					{ runId: 'run-1', event: { type: 'run.started', sessionId: 's-bg' } },
					{ runId: 'run-1', event: { type: 'user.message', text: 'Run the e2e suite' } },
					{ runId: 'run-1', event: { type: 'assistant.message', text: 'Started it.' } },
					{
						runId: 'run-1',
						event: { type: 'background.updated', waiting: true, tasks: [E2E] },
					},
				],
			},
		}),
	);
	agentRunner.__resetForTests();
	const surface = mountChatSurface(WORKSTREAM);
	stop = surface.stop;
	await vi.waitFor(() => expect(surface.host.textContent).toContain('Started it.'));
	await settleChatRoute();
	return surface.host;
}

describe('background work in a chat', () => {
	it('lists the running command with its latest output while the run waits on it', async () => {
		const host = await openChatWaitingOnE2e();

		const strip = host.querySelector('section[aria-label="1 background command running"]');
		expect(strip?.textContent).toContain('Run the e2e suite');
		expect(strip?.textContent).toContain('✓ 214 passed');
		expect(strip?.textContent).toContain('2m');
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			'Waiting on 1 background command',
		);
	});

	it('lets the user keep talking instead of queueing behind the wait', async () => {
		const host = await openChatWaitingOnE2e();

		expect(host.querySelector('form button[type="submit"]')).not.toBeNull();
		expect(
			[...host.querySelectorAll('button')].some(
				(candidate) => candidate.getAttribute('aria-label') === 'Stop current run',
			),
		).toBe(false);
	});

	it('marks the chat tab as waiting on background work, not as working', async () => {
		const host = await openChatWaitingOnE2e();

		const tab = host.querySelector<HTMLElement>(
			'[data-testid="chat-agent-tab"][data-session-id="s-bg"]',
		);
		expect(tab?.dataset['sessionStatus']).toBe('in-background');
		expect(document.getElementById(tab?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Background tasks running',
		);
	});

	it('stops one background task from its row', async () => {
		const host = await openChatWaitingOnE2e();
		const stopTask = vi.spyOn(agentSessions, 'stopBackgroundTask');

		host.querySelector<HTMLButtonElement>('button[aria-label="Stop Run the e2e suite"]')?.click();

		expect(stopTask).toHaveBeenCalledWith('s-bg', 'b1');
	});
});
