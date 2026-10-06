import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '$lib/chat/domain/session-record';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';
import WorkstreamChatSummaryHarness from './fixtures/WorkstreamChatSummaryHarness.svelte';

let stop: (() => void) | null = null;
let workstreamSeq = 0;

afterEach(() => {
	stop?.();
	stop = null;
	vi.restoreAllMocks();
	sessionsAggregate.reset();
	globalThis.localStorage.clear();
});

function workstream(): string {
	workstreamSeq += 1;
	return `ws-summary-${workstreamSeq}`;
}

function chat(
	workstreamId: string,
	sessionId: string,
	status: SessionState,
	startedAt = '2026-01-01T00:00:00.000Z',
): void {
	sessionsAggregate.hydrateSession({
		sessionId,
		workstreamId,
		displayName: sessionId,
		model: null,
		status,
		startedAt,
	});
}

function render(workstreamIds: readonly string[]): (workstreamId: string) => HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(WorkstreamChatSummaryHarness, { target: host, props: { workstreamIds } });
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
	};
	return (workstreamId) => {
		flushSync();
		const row = host.querySelector<HTMLElement>(`[data-workstream-id="${workstreamId}"]`);
		if (!row) throw new Error(`No summary for ${workstreamId}`);
		return row;
	};
}

describe('the sidebar chat summary of a workstream', () => {
	it('links to the chat that needs the user most and names what it is doing', () => {
		const running = workstream();
		const waiting = workstream();
		chat(running, 'idle-newest', 'idle', '2026-01-03T00:00:00.000Z');
		chat(running, 'running-older', 'running', '2026-01-01T00:00:00.000Z');
		chat(waiting, 'waiting', 'waiting_for_approval');
		chat(waiting, 'running-too', 'running', '2026-01-05T00:00:00.000Z');

		const summary = render([running, waiting]);

		expect(summary(running).dataset['sessionId']).toBe('running-older');
		expect(summary(running).textContent?.trim()).toBe('Running');
		expect(summary(waiting).dataset['sessionId']).toBe('waiting');
		expect(summary(waiting).textContent?.trim()).toBe('Approval');
		expect(summary(waiting).dataset['tone']).toBe('waiting');
	});

	it('counts queued prompts ahead of the last run outcome', () => {
		const queued = workstream();
		chat(queued, 'finished', 'completed');
		agentPromptQueue.enqueue({ workstreamId: queued, prompt: 'Next', model: defaultAgentModel() });
		agentPromptQueue.enqueue({ workstreamId: queued, prompt: 'After', model: defaultAgentModel() });

		const summary = render([queued]);

		expect(summary(queued).dataset['queueCount']).toBe('2');
		expect(summary(queued).textContent?.trim()).toBe('2 queued');
		agentPromptQueue.clear(queued);
		expect(summary(queued).textContent?.trim()).toBe('Ready');
	});

	it('reports unseen run attention before the session status it summarizes', () => {
		const attention = workstream();
		chat(attention, 'done', 'completed');
		const summary = render([attention]);
		expect(summary(attention).textContent?.trim()).toBe('Ready');

		agentActivity.mark(attention, { kind: 'failed', runId: 'run-1', updatedAt: 1 });

		expect(summary(attention).dataset['attention']).toBe('failed');
		expect(summary(attention).textContent?.trim()).toBe('Failed');
	});

	it('marks an unsent draft only when nothing else is happening', () => {
		const drafted = workstream();
		const idle = workstream();
		agentDrafts.setText(`${drafted}|new`, 'half a thought');

		const summary = render([drafted, idle]);

		expect(summary(drafted).dataset['draft']).toBe('true');
		expect(summary(drafted).textContent?.trim()).toBe('Draft');
		expect(summary(idle).dataset['draft']).toBe('false');
		expect(summary(idle).dataset['tone']).toBe('');
		expect(summary(idle).textContent?.trim()).toBe('Idle');
		expect(summary(idle).dataset['sessionId']).toBe('');
	});

	it('scans the chat list once per change, however many rows it summarizes', () => {
		const rows = [workstream(), workstream(), workstream(), workstream()];
		for (const [index, row] of rows.entries()) chat(row, `chat-${index}`, 'completed');
		const scans = vi.spyOn(sessionsAggregate, 'listSessions');

		const summary = render(rows);
		expect(scans).toHaveBeenCalledTimes(1);

		chat(rows[0] ?? '', 'chat-0', 'running');
		expect(summary(rows[0] ?? '').textContent?.trim()).toBe('Running');
		expect(scans).toHaveBeenCalledTimes(2);
	});
});
