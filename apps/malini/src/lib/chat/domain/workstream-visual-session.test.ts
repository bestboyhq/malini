import { describe, expect, it } from 'vitest';
import type { SessionRecord, SessionState } from '$lib/chat/domain/session-record';
import {
	preferredVisualSessionsByWorkstream,
	workstreamsRunningJobs,
} from './workstream-visual-session';

describe('preferredVisualSessionsByWorkstream', () => {
	it('preserves approval, running, then newest priority independently per workstream', () => {
		const sessions = [
			session('approval-old', 'approval', 'waiting_for_approval', '2026-07-01T00:00:00Z'),
			session('approval-new', 'approval', 'waiting_for_approval', '2026-07-03T00:00:00Z'),
			session('approval-running-newer', 'approval', 'running', '2026-07-04T00:00:00Z'),
			session('approval-idle-newest', 'approval', 'idle', '2026-07-05T00:00:00Z'),
			session('running-old', 'running', 'running', '2026-07-01T00:00:00Z'),
			session('running-new', 'running', 'running', '2026-07-03T00:00:00Z'),
			session('running-completed-newest', 'running', 'completed', '2026-07-05T00:00:00Z'),
			session('newest-old', 'newest', 'failed', '2026-07-01T00:00:00Z'),
			session('newest-new', 'newest', 'completed', '2026-07-05T00:00:00Z'),
		];

		const preferred = preferredVisualSessionsByWorkstream(sessions);

		expect(preferred.get('approval')?.id).toBe('approval-new');
		expect(preferred.get('running')?.id).toBe('running-new');
		expect(preferred.get('newest')?.id).toBe('newest-new');
	});

	it('keeps the first aggregate entry when status and timestamp are tied', () => {
		const preferred = preferredVisualSessionsByWorkstream([
			session('first', 'workstream', 'running', '2026-07-01T00:00:00Z'),
			session('second', 'workstream', 'running', '2026-07-01T00:00:00Z'),
		]);

		expect(preferred.get('workstream')?.id).toBe('first');
	});

	it('never picks a job transcript, but reports the workstreams a job is running in', () => {
		const sessions = [
			session('chat', 'workstream', 'completed', '2026-07-01T00:00:00Z'),
			{
				...session('job', 'workstream', 'running', '2026-07-02T00:00:00Z'),
				origin: 'job' as const,
			},
			{
				...session('job-done', 'quiet', 'completed', '2026-07-02T00:00:00Z'),
				origin: 'job' as const,
			},
		];

		expect(preferredVisualSessionsByWorkstream(sessions).get('workstream')?.id).toBe('chat');
		expect(preferredVisualSessionsByWorkstream(sessions).has('quiet')).toBe(false);
		expect([...workstreamsRunningJobs(sessions)]).toEqual(['workstream']);
	});
});

function session(
	id: string,
	workstreamId: string,
	status: SessionState,
	startedAt: string,
): SessionRecord {
	return {
		id,
		workstreamId,
		displayName: id,
		model: null,
		status,
		currentRunId: null,
		lastError: null,
		startedAt,
		origin: 'user',
	};
}
