import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const unlisten = vi.fn();
const onPlatformEvent = vi.fn(
	(_channel: string, _listener: (payload: unknown) => void) => unlisten,
);
const hasPlatformBridge = vi.fn(() => true);

vi.mock('$shared/port/invoke', () => ({ invoke }));
vi.mock('$shared/port/events', () => ({ onPlatformEvent, hasPlatformBridge }));

const { windowLifecycleService } = await import('./window-lifecycle.service');

const DIALOG = readFileSync(
	fileURLToPath(new URL('../../presentation/CloseConfirmationDialog.svelte', import.meta.url)),
	'utf8',
);

beforeEach(() => {
	invoke.mockReset();
	onPlatformEvent.mockClear();
	unlisten.mockClear();
});

describe('confirmed close', () => {
	it('tears the host down before the window is destroyed', async () => {
		const order: string[] = [];
		invoke.mockImplementation(async (command: string) => {
			order.push(command);
			if (command !== 'app.shutdown-gracefully') return undefined;
			return {
				containersRemoved: ['abc'],
				containersUnfinished: [],
				networksRemoved: [],
				agentRunsClosed: 1,
				timedOut: false,
				alreadyReclaimed: false,
				durationMs: 41,
				errors: [],
			};
		});

		const outcome = await windowLifecycleService.confirmShutdownAndClose();

		expect(order).toEqual(['app.shutdown-gracefully', 'app.destroy-window']);
		expect(outcome).toMatchObject({ containersRemoved: ['abc'], agentRunsClosed: 1 });
	});

	it('closes anyway when the teardown fails, because the host records the leftovers', async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === 'app.shutdown-gracefully') throw 'the daemon is not running';
			return undefined;
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await expect(windowLifecycleService.confirmShutdownAndClose()).resolves.toBeNull();
		expect(invoke).toHaveBeenCalledWith('app.destroy-window', undefined);
		error.mockRestore();
	});
});

describe('the close guard', () => {
	it('subscribes to the close request before arming, and disarms on stop', async () => {
		invoke.mockResolvedValue(undefined);
		const handler = vi.fn();

		const stop = await windowLifecycleService.armCloseGuard(handler);

		expect(onPlatformEvent.mock.calls[0]?.[0]).toBe('app:close-requested');
		expect(invoke).toHaveBeenCalledWith('app.close-guard', { armed: true });
		expect(onPlatformEvent.mock.invocationCallOrder[0]).toBeLessThan(
			invoke.mock.invocationCallOrder[0] ?? 0,
		);

		const requested = onPlatformEvent.mock.calls[0]?.[1];
		requested?.({});
		expect(handler).toHaveBeenCalledTimes(1);

		stop();
		expect(unlisten).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenLastCalledWith('app.close-guard', { armed: false });
	});

	it('leaves no listener behind when arming the guard fails', async () => {
		invoke.mockRejectedValue('no main window');

		await expect(windowLifecycleService.armCloseGuard(() => undefined)).rejects.toBe(
			'no main window',
		);
		expect(unlisten).toHaveBeenCalledTimes(1);
	});
});

describe('the dialog is the only thing that closes the window', () => {
	it('confirms through the shutdown sequence rather than destroying directly', () => {
		expect(DIALOG).toContain('confirmCloseCommand');
		expect(DIALOG).not.toContain('destroy-window');
	});

	it('shows the teardown running rather than a frozen dialog', () => {
		expect(DIALOG).toContain('Stopping what malini started…');
	});
});
