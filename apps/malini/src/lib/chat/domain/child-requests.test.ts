import { describe, expect, it } from 'vitest';
import type { AutomationRunRecord, AutomationRunStatus } from '$contract/automations';
import { askingChildren, descendantWorkstreamIds } from './child-requests';
import type { SessionRecord, SessionState } from './session-record';

function run(sessionId: string | null, status: AutomationRunStatus): AutomationRunRecord {
	return {
		id: `run-${sessionId}`,
		definitionId: 'review',
		title: 'Address review',
		workstreamId: 'switch',
		repositoryId: null,
		scope: null,
		sessionId,
		agentRunId: null,
		origin: 'manual',
		status,
		detail: null,
		parentRunId: null,
		chatSessionId: 'lead-chat',
		chatAfterRunId: null,
		chainId: `run-${sessionId}`,
		requests: 1,
		createdAt: '2026-10-25T10:00:00.000Z',
		startedAt: null,
		finishedAt: null,
	};
}

function session(
	id: string,
	status: SessionState,
	origin: 'user' | 'automation' = 'user',
): SessionRecord {
	return {
		id,
		workstreamId: 'docs',
		displayName: origin === 'automation' ? 'Fix checks' : 'Chat 1',
		provider: 'claude',
		model: null,
		status,
		currentRunId: null,
		lastError: null,
		startedAt: '2026-10-25T10:00:00.000Z',
		origin,
		latestProfile: null,
	};
}

describe('askingChildren', () => {
	it('brings up automations that need you and child chats waiting on you, once each, never the shown chat', () => {
		expect(
			askingChildren(
				'lead-chat',
				[
					run('automation-chat', 'needs-you'),
					run('busy-automation', 'running'),
					run(null, 'needs-you'),
				],
				[
					session('automation-chat', 'waiting_for_approval', 'automation'),
					session('docs-chat', 'waiting_for_approval'),
					session('fix-chat', 'waiting_for_approval', 'automation'),
					session('idle-chat', 'completed'),
					session('lead-chat', 'waiting_for_approval'),
				],
			),
		).toEqual([
			{ sessionId: 'automation-chat', workstreamId: 'switch', automation: 'Address review' },
			{ sessionId: 'docs-chat', workstreamId: 'docs', automation: null },
			{ sessionId: 'fix-chat', workstreamId: 'docs', automation: 'Fix checks' },
		]);
	});

	it('reaches every workstream started down the tree, and stops at a loop', () => {
		expect(
			descendantWorkstreamIds('lead', [
				{ id: 'lead', startedBy: 'grandchild' },
				{ id: 'child', startedBy: 'lead' },
				{ id: 'grandchild', startedBy: 'child' },
				{ id: 'great-grandchild', startedBy: 'grandchild' },
				{ id: 'sibling', startedBy: null },
			]),
		).toEqual(new Set(['child', 'grandchild', 'great-grandchild']));
	});
});
