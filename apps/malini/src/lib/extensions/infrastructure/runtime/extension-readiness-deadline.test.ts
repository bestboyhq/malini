import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtensionWorkstreamReadinessDeadline } from './extension-readiness-deadline';

describe('ExtensionWorkstreamReadinessDeadline', () => {
	afterEach(() => vi.useRealTimers());

	it('does not count slow projection or retained-paint deferral as activation time', () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new ExtensionWorkstreamReadinessDeadline({ deadlineMs: 80, onTimeout });

		deadline.defer('workstream-a');
		vi.advanceTimersByTime(800);
		expect(onTimeout).not.toHaveBeenCalled();

		expect(deadline.start('workstream-a')).toBe(true);
		vi.advanceTimersByTime(79);
		expect(onTimeout).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledOnce();
		expect(onTimeout).toHaveBeenCalledWith('workstream-a');
	});

	it('settles an eventual activation without publishing a late failure', () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new ExtensionWorkstreamReadinessDeadline({ deadlineMs: 80, onTimeout });

		deadline.defer('workstream-a');
		deadline.start('workstream-a');
		deadline.settle('workstream-a');
		vi.advanceTimersByTime(100);

		expect(onTimeout).not.toHaveBeenCalled();
	});

	it('cancels the active clock when a newer workstream supersedes it', () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new ExtensionWorkstreamReadinessDeadline({ deadlineMs: 80, onTimeout });

		deadline.defer('workstream-a');
		deadline.start('workstream-a');
		vi.advanceTimersByTime(40);
		deadline.defer('workstream-b');
		vi.advanceTimersByTime(500);
		expect(onTimeout).not.toHaveBeenCalled();
		expect(deadline.start('workstream-a')).toBe(false);

		expect(deadline.start('workstream-b')).toBe(true);
		vi.advanceTimersByTime(79);
		expect(onTimeout).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onTimeout).toHaveBeenCalledWith('workstream-b');
	});

	it('ignores stale settlement and scope-specific cancellation', () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new ExtensionWorkstreamReadinessDeadline({ deadlineMs: 80, onTimeout });

		deadline.defer('workstream-b');
		deadline.start('workstream-b');
		deadline.settle('workstream-a');
		deadline.cancel('workstream-a');
		vi.advanceTimersByTime(80);
		expect(onTimeout).toHaveBeenCalledWith('workstream-b');
	});

	it('lets a timed-out workstream defer and recover on retry', () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new ExtensionWorkstreamReadinessDeadline({ deadlineMs: 80, onTimeout });

		deadline.defer('workstream-b');
		deadline.start('workstream-b');
		vi.advanceTimersByTime(80);
		expect(onTimeout).toHaveBeenCalledOnce();

		deadline.defer('workstream-b');
		vi.advanceTimersByTime(100);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		deadline.start('workstream-b');
		deadline.settle('workstream-b');
		vi.advanceTimersByTime(100);
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});
});
