import { describe, expect, it } from 'vitest';

import type { AgentRunProfile } from '$shared/providers/domain/run-profile';
import {
	captureCheckpointEditTarget,
	checkpointEditTargetIsCurrent,
	executeCheckpointEdit,
} from './checkpoint-edit-target';

describe('checkpoint edit target', () => {
	it('captures an immutable exact workstream, chat, model, and profile snapshot', () => {
		const profile: AgentRunProfile = { mode: 'plan', effort: 'high', access: 'sandboxed' };
		const target = captureCheckpointEditTarget({
			workstreamId: 'workstream-a',
			sessionId: 'session-a',
			model: 'opus',
			profile,
		});

		profile.mode = 'agent';
		profile.effort = 'low';

		expect(target).toEqual({
			workstreamId: 'workstream-a',
			sessionId: 'session-a',
			model: 'opus',
			profile: { mode: 'plan', effort: 'high', access: 'sandboxed' },
		});
	});

	it('rejects an edit target until both workstream and chat are ready', () => {
		const base = {
			model: 'sonnet' as const,
			profile: { mode: 'agent' as const, effort: 'high' as const, access: 'sandboxed' as const },
		};
		expect(
			captureCheckpointEditTarget({ ...base, workstreamId: '', sessionId: 'session-a' }),
		).toBeNull();
		expect(
			captureCheckpointEditTarget({ ...base, workstreamId: 'workstream-a', sessionId: null }),
		).toBeNull();
	});

	it('becomes stale on route, workstream, or selected-chat changes', () => {
		const target = { workstreamId: 'workstream-a', sessionId: 'session-a' };
		expect(
			checkpointEditTargetIsCurrent(target, {
				workstreamId: 'workstream-a',
				sessionId: 'session-a',
				navigationTargetsWorkstream: true,
			}),
		).toBe(true);
		expect(
			checkpointEditTargetIsCurrent(target, {
				workstreamId: 'workstream-b',
				sessionId: 'session-a',
				navigationTargetsWorkstream: true,
			}),
		).toBe(false);
		expect(
			checkpointEditTargetIsCurrent(target, {
				workstreamId: 'workstream-a',
				sessionId: 'session-b',
				navigationTargetsWorkstream: true,
			}),
		).toBe(false);
		expect(
			checkpointEditTargetIsCurrent(target, {
				workstreamId: 'workstream-a',
				sessionId: 'session-a',
				navigationTargetsWorkstream: false,
			}),
		).toBe(false);
	});

	it('submits the captured target unchanged after restore completes', async () => {
		const target = captureCheckpointEditTarget({
			workstreamId: 'workstream-a',
			sessionId: 'session-a',
			model: 'opus',
			profile: { mode: 'plan', effort: 'high', access: 'sandboxed' },
		});
		expect(target).not.toBeNull();
		if (!target) return;
		const restoredTargets: unknown[] = [];
		const submittedTargets: unknown[] = [];

		const completed = await executeCheckpointEdit(target, {
			restore: async (captured) => {
				restoredTargets.push(captured);
				return true;
			},
			isCurrent: () => true,
			submit: (captured) => {
				submittedTargets.push(captured);
			},
		});

		expect(completed).toBe(true);
		expect(restoredTargets).toEqual([target]);
		expect(submittedTargets).toEqual([target]);
	});

	it('does not submit when the chat becomes stale during async restore', async () => {
		const target = captureCheckpointEditTarget({
			workstreamId: 'workstream-a',
			sessionId: 'session-a',
			model: 'sonnet',
			profile: { mode: 'agent', effort: 'high', access: 'sandboxed' },
		});
		expect(target).not.toBeNull();
		if (!target) return;
		let releaseRestore!: () => void;
		const restorePending = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		let targetIsCurrent = true;
		let submitCount = 0;
		const operation = executeCheckpointEdit(target, {
			restore: async () => {
				await restorePending;
				return true;
			},
			isCurrent: () => targetIsCurrent,
			submit: () => {
				submitCount += 1;
			},
		});

		targetIsCurrent = false;
		releaseRestore();

		await expect(operation).resolves.toBe(false);
		expect(submitCount).toBe(0);
	});
});
