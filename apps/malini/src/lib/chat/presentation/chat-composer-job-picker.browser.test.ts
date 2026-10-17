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

function press(target: HTMLElement, key: string): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

function selectedOption(): string | undefined {
	return document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim();
}

describe('running a job from the composer', () => {
	it('keeps a typed slash in the prompt, steers the job list from the prompt and runs the highlighted job from this chat', async () => {
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

		await vi.waitFor(() => expect(byName('[role="listbox"]', 'Jobs')).not.toBeNull());
		expect(prompt.textContent).toBe('/');
		expect(document.activeElement).toBe(prompt);
		expect(byName('input', 'Find a job')).toBeNull();
		await vi.waitFor(() => expect(selectedOption()).toMatch(/^Fix checks/u));
		const firstOption = document.querySelector('[role="option"][aria-selected="true"]');
		expect(prompt.getAttribute('aria-activedescendant')).toBe(firstOption?.id);

		press(prompt, 'ArrowDown');
		expect(selectedOption()).not.toMatch(/^Fix checks/u);
		press(prompt, 'ArrowUp');
		expect(selectedOption()).toMatch(/^Fix checks/u);
		press(prompt, 'Enter');

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
		await vi.waitFor(() => expect(prompt.textContent).toBe(''));
		expect(prompt.hasAttribute('aria-activedescendant')).toBe(false);
	});
});
