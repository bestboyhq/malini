import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererToastPayload } from '$contract/diagnostics';
import type { ShownToast } from '$hyper-ui/components/toast';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { installToastRecording } from './toast-recorder';

vi.mock('svelte-sonner', () => ({ toast: { custom: () => 'toast-id', dismiss: () => undefined } }));

afterEach(() => {
	setPlatformForTest(null);
});

function toastSource(): {
	observe: (observer: (shown: ShownToast) => void) => () => void;
	show: (shown: ShownToast) => void;
} {
	const observers = new Set<(shown: ShownToast) => void>();
	return {
		observe: (observer) => {
			observers.add(observer);
			return () => observers.delete(observer);
		},
		show: (shown) => {
			for (const observer of observers) observer(shown);
		},
	};
}

describe('recording the toasts a user sees', () => {
	it('records every toast with its level, route, time and workstream, and the text only of warnings and errors', () => {
		const source = toastSource();
		const persisted: RendererToastPayload[] = [];
		const stop = installToastRecording({
			observe: source.observe,
			persist: async (payload) => persisted.push(payload),
			now: () => new Date('2026-09-23T08:00:00.000Z'),
			route: () => '/workstreams/ws-1',
		});

		source.show({
			level: 'error',
			message: 'Could not archive Neon Circuit · It is in use',
			context: { workstream: 'ws-2' },
		});
		source.show({
			level: 'warning',
			message: 'Workstream archived, but its extension cleanup needs attention',
			context: {},
		});
		source.show({
			level: 'info',
			message: 'Claude is waiting · Should I delete the billing tables?',
			context: { workstream: 'ws-3' },
		});
		source.show({ level: 'success', message: 'Committed abc · fix billing', context: {} });
		stop();
		source.show({ level: 'error', message: 'after stop', context: {} });

		expect(persisted).toEqual([
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:00.000Z',
				route: '/workstreams/ws-1',
				level: 'error',
				text: 'Could not archive Neon Circuit · It is in use',
				workstreamId: 'ws-2',
			},
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:00.000Z',
				route: '/workstreams/ws-1',
				level: 'warning',
				text: 'Workstream archived, but its extension cleanup needs attention',
				workstreamId: null,
			},
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:00.000Z',
				route: '/workstreams/ws-1',
				level: 'info',
				text: null,
				workstreamId: 'ws-3',
			},
			{
				schemaVersion: 1,
				occurredAt: '2026-09-23T08:00:00.000Z',
				route: '/workstreams/ws-1',
				level: 'success',
				text: null,
				workstreamId: null,
			},
		]);
	});

	it('keeps at most thirty toasts in ten seconds and never throws when persisting fails', async () => {
		const source = toastSource();
		let clock = Date.parse('2026-09-23T08:00:00.000Z');
		let attempts = 0;
		installToastRecording({
			observe: source.observe,
			persist: async () => {
				attempts += 1;
				throw new Error('main is gone');
			},
			now: () => new Date(clock),
			route: () => '/',
		});

		for (let index = 0; index < 40; index += 1)
			source.show({ level: 'warning', message: `${index}`, context: {} });
		clock += 10_000;
		source.show({ level: 'warning', message: 'next window', context: {} });
		await Promise.resolve();

		expect(attempts).toBe(31);
	});

	it('sends the toasts hyper-ui shows to the platform through app.report-toast', async () => {
		const platform = createFakePlatform();
		setPlatformForTest(platform);
		const { toast } = await import('$hyper-ui/components/toast');
		const stop = installToastRecording({ route: () => '/workstreams/ws-7' });

		toast.error('Push failed · remote rejected');
		toast.error('Could not delete Neon Circuit · It is in use', {
			context: { workstream: 'ws-3' },
		});
		stop();

		await expect
			.poll(() => platform.calls.filter((call) => call.command === 'app.report-toast'))
			.toEqual([
				{
					command: 'app.report-toast',
					args: {
						payload: expect.objectContaining({
							level: 'error',
							text: 'Push failed · remote rejected',
							route: '/workstreams/ws-7',
							workstreamId: null,
						}),
					},
				},
				{
					command: 'app.report-toast',
					args: {
						payload: expect.objectContaining({
							text: 'Could not delete Neon Circuit · It is in use',
							route: '/workstreams/ws-7',
							workstreamId: 'ws-3',
						}),
					},
				},
			]);
	});
});
