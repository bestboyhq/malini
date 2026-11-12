import { describe, expect, it } from 'vitest';
import type { AutomationRunRecord, AutomationRunStatus } from '$contract/automations';
import { askingAutomations, waitingElsewhere } from './requests-elsewhere';
import type { SessionRecord, SessionState } from './session-record';

function run(sessionId: string | null, status: AutomationRunStatus): AutomationRunRecord {
	return {
		id: `run-${sessionId}`,
		definitionId: 'review',
		title: 'Address review',
		workstreamId: 'switch',
		repositoryId: null,
		sessionId,
		agentRunId: null,
		origin: 'manual',
		status,
		interrupted: false,
		detail: null,
		parentRunId: null,
		chatSessionId: 'root-chat',
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

describe('requests elsewhere', () => {
	it('brings up the automations that need you, once each, never the shown chat', () => {
		expect(
			askingAutomations('shown-automation', [
				run('automation-chat', 'needs-you'),
				run('automation-chat', 'needs-you'),
				run('busy-automation', 'running'),
				run(null, 'needs-you'),
				run('shown-automation', 'needs-you'),
			]),
		).toEqual([
			{ sessionId: 'automation-chat', workstreamId: 'switch', automation: 'Address review' },
		]);
	});

	it('lists every other chat waiting on you, past the shown chat and the automations already asking', () => {
		const asking = askingAutomations(null, [run('automation-chat', 'needs-you')]);
		expect(
			waitingElsewhere('root-chat', asking, [
				session('automation-chat', 'waiting_for_approval', 'automation'),
				session('docs-chat', 'waiting_for_approval'),
				session('fix-chat', 'waiting_for_approval', 'automation'),
				session('idle-chat', 'completed'),
				session('root-chat', 'waiting_for_approval'),
			]),
		).toEqual([
			{ sessionId: 'docs-chat', workstreamId: 'docs', automation: null },
			{ sessionId: 'fix-chat', workstreamId: 'docs', automation: 'Fix checks' },
		]);
	});
});
