import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoutineGatedRunRecord } from '$contract/routines';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { attachRoutineGateDecisions } from './routine-gate-decisions.service';
import { onRoutinesChanged } from './routines-changed.service';

afterEach(() => {
	setPlatformForTest(null);
});

function installFake(): FakePlatform {
	const fake = createFakePlatform();
	setPlatformForTest(fake);
	return fake;
}

function gatedRun(id: string, state: RoutineGatedRunRecord['state']): RoutineGatedRunRecord {
	return {
		id,
		routineId: 'routine-1',
		workstreamId: 'workstream-1',
		runKey: `run-${id}`,
		event: 'workstream.created',
		payload: {},
		state,
		createdAt: '2026-01-01T00:00:00.000Z',
		decidedAt: null,
	};
}

function decisions(pending: readonly RoutineGatedRunRecord[]): {
	pendingGatedRuns: readonly RoutineGatedRunRecord[];
	confirmGatedRun: (id: string) => Promise<void>;
	rejectGatedRun: (id: string) => Promise<void>;
} {
	return {
		pendingGatedRuns: pending,
		confirmGatedRun: vi.fn(async () => undefined),
		rejectGatedRun: vi.fn(async () => undefined),
	};
}

describe('attachRoutineGateDecisions', () => {
	it('applies a confirmed or rejected held run and ignores pending and unknown runs', () => {
		const fake = installFake();
		const runtime = decisions([gatedRun('held-a', 'pending'), gatedRun('held-b', 'pending')]);
		attachRoutineGateDecisions(runtime);

		fake.emit('routines:gated-run-changed', { gatedRun: gatedRun('held-a', 'confirmed') });
		fake.emit('routines:gated-run-changed', { gatedRun: gatedRun('held-b', 'rejected') });
		fake.emit('routines:gated-run-changed', { gatedRun: gatedRun('held-a', 'pending') });
		fake.emit('routines:gated-run-changed', { gatedRun: gatedRun('elsewhere', 'confirmed') });

		expect(runtime.confirmGatedRun).toHaveBeenCalledExactlyOnceWith('held-a');
		expect(runtime.rejectGatedRun).toHaveBeenCalledExactlyOnceWith('held-b');
	});

	it('reports a failed decision and stops listening once detached', async () => {
		const fake = installFake();
		const runtime = decisions([gatedRun('held-a', 'pending')]);
		vi.mocked(runtime.confirmGatedRun).mockRejectedValueOnce('gate store offline');
		const onError = vi.fn();
		const detach = attachRoutineGateDecisions(runtime, onError);

		fake.emit('routines:gated-run-changed', { gatedRun: gatedRun('held-a', 'confirmed') });
		await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
		expect(onError.mock.calls[0]?.[0]).toEqual(new Error('gate store offline'));

		detach();
		expect(fake.listenerCount('routines:gated-run-changed')).toBe(0);
	});
});

describe('onRoutinesChanged', () => {
	it('notifies on every routines change until unsubscribed', () => {
		const fake = installFake();
		const listener = vi.fn();
		const unsubscribe = onRoutinesChanged(listener);

		fake.emit('routines:changed', { routine: null });
		unsubscribe();
		fake.emit('routines:changed', { routine: null });

		expect(listener).toHaveBeenCalledOnce();
	});
});
