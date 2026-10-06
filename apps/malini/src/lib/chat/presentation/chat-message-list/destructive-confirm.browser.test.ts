import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import {
	mountDestructiveConfirm,
	type DestructiveConfirmHarness,
} from '../destructive-confirm-harness.svelte';

let harness: DestructiveConfirmHarness | null = null;

afterEach(() => {
	harness?.stop();
	harness = null;
});

function mount(): DestructiveConfirmHarness {
	harness = mountDestructiveConfirm();
	return harness;
}

function request(key: string, changeCount = 1) {
	const performed: ChatRequestId[] = [];
	return {
		performed,
		request: {
			key,
			changeCount: () => changeCount,
			perform: vi.fn((requestId: ChatRequestId) => {
				performed.push(requestId);
				harness?.settle(requestId, { status: 'pending' });
			}),
		},
	};
}

describe('arming a destructive action', () => {
	it('records the cost and calls nothing on the first attempt', () => {
		const { confirmation } = mount();
		const undo = request('run-1', 3);

		expect(confirmation.confirm(undo.request)).toBe(false);

		expect(undo.request.perform).not.toHaveBeenCalled();
		expect(confirmation.isArmed('run-1')).toBe(true);
		expect(confirmation.armedChangeCount).toBe(3);
	});

	it('dispatches on the second attempt and stays armed and busy until the request settles', () => {
		const { confirmation, settle, accepted } = mount();
		const undo = request('run-1');

		confirmation.confirm(undo.request);
		expect(confirmation.confirm(undo.request)).toBe(true);

		expect(undo.request.perform).toHaveBeenCalledTimes(1);
		expect(confirmation.state).toBe('submitting');
		expect(confirmation.isArmed('run-1')).toBe(true);

		settle(undo.performed[0] ?? '', { status: 'pending' });
		flushSync();
		expect(confirmation.state).toBe('submitting');

		settle(undo.performed[0] ?? '', { status: 'accepted' });
		flushSync();
		expect(confirmation.state).toBe('idle');
		expect(confirmation.isArmed('run-1')).toBe(false);
		expect(accepted).toEqual(['run-1']);
	});

	it('re-arms rather than calling out when a different thing is confirmed', () => {
		const { confirmation } = mount();
		const first = request('run-1');
		const second = request('run-2', 4);

		confirmation.confirm(first.request);
		confirmation.confirm(second.request);

		expect(first.request.perform).not.toHaveBeenCalled();
		expect(second.request.perform).not.toHaveBeenCalled();
		expect(confirmation.isArmed('run-1')).toBe(false);
		expect(confirmation.isArmed('run-2')).toBe(true);
		expect(confirmation.armedChangeCount).toBe(4);
	});

	it('keeps the failure, says which attempt produced it, and disarms', () => {
		const { confirmation, settle, accepted } = mount();
		const undo = request('run-1', 2);

		confirmation.confirm(undo.request);
		confirmation.confirm(undo.request);
		settle(undo.performed[0] ?? '', { status: 'failed', error: 'the workstream moved' });
		flushSync();

		expect(confirmation.state).toBe('failed');
		expect(confirmation.error).toBe('the workstream moved');
		expect(confirmation.errorKey).toBe('run-1');
		expect(confirmation.isArmed('run-1')).toBe(false);
		expect(accepted).toEqual([]);
	});

	it('ignores a confirmation raised while one is still in flight', () => {
		const { confirmation, settle } = mount();
		const undo = request('run-1');

		confirmation.confirm(undo.request);
		confirmation.confirm(undo.request);
		expect(confirmation.state).toBe('submitting');

		expect(confirmation.confirm(undo.request)).toBe(false);
		expect(confirmation.confirm(request('run-2').request)).toBe(false);
		expect(undo.request.perform).toHaveBeenCalledTimes(1);

		settle(undo.performed[0] ?? '', { status: 'accepted' });
		flushSync();
		expect(confirmation.state).toBe('idle');
	});

	it('clears a previous failure when something else is armed', () => {
		const { confirmation, settle } = mount();
		const undo = request('run-1');
		confirmation.confirm(undo.request);
		confirmation.confirm(undo.request);
		settle(undo.performed[0] ?? '', { status: 'failed', error: 'boom' });
		flushSync();

		confirmation.confirm(request('run-2').request);

		expect(confirmation.error).toBeNull();
		expect(confirmation.errorKey).toBeNull();
	});

	it('backs all the way out on reset and leaves the error on plain disarm', () => {
		const { confirmation, settle } = mount();
		const undo = request('k');
		confirmation.confirm(undo.request);
		confirmation.confirm(undo.request);
		settle(undo.performed[0] ?? '', { status: 'failed', error: 'boom' });
		flushSync();

		confirmation.disarm();
		expect(confirmation.error).toBe('boom');

		confirmation.reset();
		expect(confirmation.error).toBeNull();
		expect(confirmation.errorKey).toBeNull();
		expect(confirmation.state).toBe('idle');
	});

	it('is armed for nothing when no key is supplied', () => {
		const { confirmation } = mount();
		expect(confirmation.isArmed(null)).toBe(false);
		expect(confirmation.isArmed(undefined)).toBe(false);
	});
});
