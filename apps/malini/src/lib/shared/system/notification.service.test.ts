import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform } from '$shared/port/fake/create-fake-platform';

type Harness = Readonly<{
	fake: FakePlatform;
	info: ReturnType<typeof vi.fn>;
	notify: (title: string, body: string) => Promise<void>;
	notifyAboutChat: (title: string, body: string, sessionId: string) => Promise<void>;
	onOpen: (listener: (target: unknown) => void) => () => void;
}>;

afterEach(() => {
	vi.resetModules();
});

async function harness(
	permission: boolean | null,
	requested: 'granted' | 'denied',
): Promise<Harness> {
	vi.resetModules();
	const { createFakePlatform } = await import('$shared/port/fake/create-fake-platform');
	const { setPlatformForTest } = await import('$shared/port/platform');
	const { toast } = await import('$hyper-ui/components/toast');
	const { notificationService } = await import('./notification.service');
	const fake = createFakePlatform();
	fake.define('app.notification-permission-granted', async () => permission);
	fake.define('app.request-notification-permission', async () => requested);
	fake.define('app.notify', async () => undefined);
	setPlatformForTest(fake);
	const info = vi.fn();
	vi.spyOn(toast, 'info').mockImplementation((message, options) => {
		info(message, options);
		return 'toast';
	});
	return {
		fake,
		info,
		notify: (title, body) => notificationService.notify(title, body, 'ws-1'),
		notifyAboutChat: (title, body, sessionId) =>
			notificationService.notify(title, body, 'ws-1', sessionId),
		onOpen: (listener) => notificationService.onOpen(listener),
	};
}

describe('notificationService', () => {
	it('shows a native notification once permission is granted and checks permission once', async () => {
		const { fake, notify } = await harness(true, 'denied');

		await notify('Run finished', 'All checks passed');
		await notify('Run finished', 'Again');

		expect(fake.calls.map(({ command }) => command)).toEqual([
			'app.notification-permission-granted',
			'app.notify',
			'app.notify',
		]);
		expect(fake.calls[1]?.args).toEqual({
			options: { title: 'Run finished', body: 'All checks passed' },
		});
	});

	it('asks for permission once and stays quiet when it is denied or the notification fails', async () => {
		const { fake, info, notify } = await harness(false, 'denied');

		await notify('Run finished', 'All checks passed');

		expect(fake.calls.map(({ command }) => command)).toEqual([
			'app.notification-permission-granted',
			'app.request-notification-permission',
		]);
		const granted = await harness(true, 'granted');
		granted.fake.define('app.notify', async () => {
			throw new Error('notification center unavailable');
		});
		await granted.notify('Run finished', 'All checks passed');
		expect(info).not.toHaveBeenCalled();
		expect(granted.info).not.toHaveBeenCalled();
	});

	it('asks the platform to open the chat a notification is about when it is clicked', async () => {
		const { fake, notifyAboutChat, onOpen } = await harness(true, 'denied');
		const opened: unknown[] = [];
		const stop = onOpen((target) => opened.push(target));

		await notifyAboutChat('Lunar Relay is waiting', 'Which option?', 'chat-1');
		expect(fake.calls.at(-1)?.args).toEqual({
			options: {
				title: 'Lunar Relay is waiting',
				body: 'Which option?',
				opens: { workstreamId: 'ws-1', sessionId: 'chat-1' },
			},
		});
		const clicked = [{ workstreamId: 'ws-1', sessionId: 'chat-1' }];
		fake.define('app.take-notification-target', async () => clicked.shift() ?? null);
		fake.emit('app:notification-opened', { workstreamId: 'ws-1', sessionId: 'chat-1' });

		await vi.waitFor(() => expect(opened).toEqual([{ workstreamId: 'ws-1', sessionId: 'chat-1' }]));
		stop();
	});

	it('opens the chat of a notification clicked while no window was open, once a window listens', async () => {
		const { fake, onOpen } = await harness(true, 'denied');
		fake.define('app.take-notification-target', async () => ({
			workstreamId: 'ws-1',
			sessionId: 'chat-1',
		}));
		const opened: unknown[] = [];

		const stop = onOpen((target) => opened.push(target));

		await vi.waitFor(() => expect(opened).toEqual([{ workstreamId: 'ws-1', sessionId: 'chat-1' }]));
		stop();
	});
});
