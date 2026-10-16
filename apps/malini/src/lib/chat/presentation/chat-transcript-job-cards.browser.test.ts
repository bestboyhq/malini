import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobRunRecord } from '$contract/jobs';
import { openChatRoute, resetChatState } from '$lib/chat/application/chat-route.testkit.svelte';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { seedFakeJobRun } from '$shared/port/fake/jobs.fake';
import { mountChatSurface } from './chat-surface.harness.svelte';

const WORKSTREAM = 'ws-cards';

let stop: (() => void) | null = null;

afterEach(async () => {
	stop?.();
	stop = null;
	jobRunsAggregate.reset();
	jobDefinitionsAggregate.reset();
	jobActionsStore.reset();
	await resetChatState();
});

function jobRun(id: string, patch: Partial<JobRunRecord>): JobRunRecord {
	return {
		id,
		definitionId: 'fake-job-fix-checks',
		title: 'Fix checks',
		workstreamId: WORKSTREAM,
		repositoryId: null,
		sessionId: null,
		agentRunId: null,
		origin: 'manual',
		status: 'queued',
		detail: null,
		chatSessionId: 's-chat',
		chatAfterRunId: null,
		createdAt: new Date().toISOString(),
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function card(name: string): HTMLElement {
	const found = document.querySelector<HTMLElement>(`article[aria-label="${name}"]`);
	if (!found) throw new Error(`no card named ${name}`);
	return found;
}

function textNode(host: HTMLElement, text: string): Node {
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.textContent?.includes(text)) return node;
	}
	throw new Error(`no text ${text}`);
}

function inOrder(...nodes: Node[]): boolean {
	return nodes.every(
		(node, index) =>
			index === 0 ||
			((nodes[index - 1]?.compareDocumentPosition(node) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING) !==
				0,
	);
}

describe('job cards in a chat transcript', () => {
	it('places a job after the run it was started from, and an orphaned one last', async () => {
		const platform = createFakePlatform({
			agentSessions: [{ id: 's-chat', workstreamId: WORKSTREAM }],
			agentEvents: {
				's-chat': [
					{ runId: 'run-1', event: { type: 'user.message', text: 'First question' } },
					{ runId: 'run-1', event: { type: 'assistant.message', text: 'First answer' } },
					{ runId: 'run-1', event: { type: 'run.completed', summary: 'One' } },
					{ runId: 'run-2', event: { type: 'user.message', text: 'Second question' } },
					{ runId: 'run-2', event: { type: 'assistant.message', text: 'Second answer' } },
					{ runId: 'run-2', event: { type: 'run.completed', summary: 'Two' } },
				],
			},
		});
		seedFakeJobRun(platform, jobRun('job-after-first', { chatAfterRunId: 'run-1' }));
		seedFakeJobRun(
			platform,
			jobRun('job-orphan', { title: 'Update from main', chatAfterRunId: 'run-undone' }),
		);
		await openChatRoute(`/workstreams/${WORKSTREAM}`, platform);
		const surface = mountChatSurface(WORKSTREAM);
		stop = surface.stop;

		await vi.waitFor(() => expect(surface.host.textContent).toContain('Second answer'));
		await vi.waitFor(() => card('Job Update from main'));

		expect(
			inOrder(
				textNode(surface.host, 'First answer'),
				card('Job Fix checks'),
				textNode(surface.host, 'Second answer'),
				card('Job Update from main'),
			),
		).toBe(true);
	});
});
