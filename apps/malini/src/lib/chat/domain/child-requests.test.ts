import { describe, expect, it } from 'vitest';
import type { JobRunRecord, JobRunStatus } from '$contract/jobs';
import { askingChildren, descendantWorkstreamIds } from './child-requests';
import type { SessionRecord, SessionState } from './session-record';

function run(sessionId: string | null, status: JobRunStatus): JobRunRecord {
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
		createdAt: '2026-10-25T10:00:00.000Z',
		startedAt: null,
		finishedAt: null,
	};
}

function session(id: string, status: SessionState, origin: 'user' | 'job' = 'user'): SessionRecord {
	return {
		id,
		workstreamId: 'docs',
		displayName: origin === 'job' ? 'Fix checks' : 'Chat 1',
		model: null,
		status,
		currentRunId: null,
		lastError: null,
		startedAt: '2026-10-25T10:00:00.000Z',
		origin,
	};
}

describe('askingChildren', () => {
	it('brings up jobs that need you and child chats waiting on you, once each, never the shown chat', () => {
		expect(
			askingChildren(
				'lead-chat',
				[run('job-chat', 'needs-you'), run('busy-job', 'running'), run(null, 'needs-you')],
				[
					session('job-chat', 'waiting_for_approval', 'job'),
					session('docs-chat', 'waiting_for_approval'),
					session('fix-chat', 'waiting_for_approval', 'job'),
					session('idle-chat', 'completed'),
					session('lead-chat', 'waiting_for_approval'),
				],
			),
		).toEqual([
			{ sessionId: 'job-chat', workstreamId: 'switch', job: 'Address review' },
			{ sessionId: 'docs-chat', workstreamId: 'docs', job: null },
			{ sessionId: 'fix-chat', workstreamId: 'docs', job: 'Fix checks' },
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
