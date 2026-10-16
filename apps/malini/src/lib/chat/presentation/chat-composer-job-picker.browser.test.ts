import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatRoute, resetChatState } from '$lib/chat/application/chat-route.testkit.svelte';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { mountChatSurface } from './chat-surface.harness.svelte';

const WORKSTREAM = 'ws-jobs';
const originalGetSelection = window.getSelection.bind(window);

let stop: (() => void) | null = null;

afterEach(async () => {
	Object.defineProperty(window, 'getSelection', {
		configurable: true,
		writable: true,
		value: originalGetSelection,
	});
	stop?.();
	stop = null;
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	jobActionsStore.reset();
	await resetChatState();
});

function byName(role: string, name: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`${role}[aria-label="${name}"]`);
}

function typeAtStartOf(prompt: HTMLElement, key: string): void {
	prompt.focus();
	const caret = document.createRange();
	caret.setStart(prompt, 0);
	caret.collapse(true);
	Object.defineProperty(window, 'getSelection', {
		configurable: true,
		writable: true,
		value: () => ({ rangeCount: 1, isCollapsed: true, getRangeAt: () => caret }),
	});
	prompt.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

describe('running a job from the composer', () => {
	it('opens the job picker on a typed slash and runs the highlighted job from this chat', async () => {
		const platform = await openChatRoute(
			`/workstreams/${WORKSTREAM}`,
			createFakePlatform({
				agentSessions: [{ id: 's-chat', workstreamId: WORKSTREAM }],
				agentEvents: {
					's-chat': [
						{ runId: 'run-1', event: { type: 'user.message', text: 'Tidy the parser' } },
						{ runId: 'run-1', event: { type: 'assistant.message', text: 'Tidied it' } },
						{ runId: 'run-1', event: { type: 'run.completed', summary: 'Tidied' } },
						{ runId: '', event: { type: 'session.state', status: 'idle' } },
					],
				},
			}),
		);
		const surface = mountChatSurface(WORKSTREAM);
		stop = surface.stop;
		await vi.waitFor(() => expect(surface.host.textContent).toContain('Tidied it'));
		const prompt = byName('[role="textbox"]', 'Chat prompt');
		if (!prompt) throw new Error('no chat prompt');
		await vi.waitFor(() => expect(prompt.getAttribute('aria-disabled')).toBe('false'));

		typeAtStartOf(prompt, '/');

		await vi.waitFor(() => expect(byName('[role="dialog"]', 'Run a job')).not.toBeNull());
		await vi.waitFor(() =>
			expect(
				document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim(),
			).toMatch(/^Fix checks/u),
		);
		byName('input', 'Find a job')?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		flushSync();

		await vi.waitFor(() =>
			expect(platform.calls.find(({ command }) => command === 'jobs.run')?.args).toEqual({
				definitionId: 'fake-job-fix-checks',
				workstreamId: WORKSTREAM,
				chatSessionId: 's-chat',
				chatAfterRunId: 'run-1',
				origin: 'manual',
			}),
		);
		await vi.waitFor(() => expect(byName('article', 'Job Fix checks')).not.toBeNull());
	});
});
