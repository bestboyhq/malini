import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CommandFailureModule from '$contract/command-failure';
import type * as EventsModule from './events';
import { FakeBridge } from './fake/fake-bridge';
import type * as InvokeModule from './invoke';
import type * as PlatformModule from './platform';

type PortModules = {
	commandFailure: typeof CommandFailureModule;
	platform: typeof PlatformModule;
	invoke: typeof InvokeModule;
	events: typeof EventsModule;
};

describe('the platform the renderer talks to', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('answers from the fake platform when no preload bridge exists', async () => {
		const { invoke } = await freshPort();

		await expect(invoke.invoke('app.list-settings', undefined)).resolves.toMatchObject({
			'chat.default-model': 'haiku',
		});
	});

	it('reaches the preload bridge once window.malini exposes one', async () => {
		const native = nativeBridge();
		vi.stubGlobal('window', { malini: native });
		const { invoke, events } = await freshPort();

		await invoke.invoke('app.focus-window', undefined);
		const received: unknown[] = [];
		const off = events.onPlatformEvent('app:scale-changed', (payload) => received.push(payload));
		native.emit('app:scale-changed', {});
		off();
		native.emit('app:scale-changed', {});

		expect(native.calls).toEqual([{ command: 'app.focus-window', args: undefined }]);
		expect(received).toEqual([{}]);
		expect(events.hasPlatformBridge()).toBe(true);
	});

	it('keeps the fake platform when the fake is requested even with a preload bridge', async () => {
		const native = nativeBridge();
		vi.stubGlobal('window', { malini: native });
		const { platform, invoke } = await freshPort();

		platform.requestFakePlatform();
		await invoke.invoke('app.focus-window', undefined);

		expect(native.calls).toEqual([]);
	});

	it('routes every call to the bridge a test installs, and back once it is removed', async () => {
		const { platform, invoke } = await freshPort();
		const testBridge = nativeBridge();

		platform.setPlatformForTest(testBridge);
		await invoke.invoke('app.copy-text', { text: 'hello' });
		platform.setPlatformForTest(null);
		await invoke.invoke('app.copy-text', { text: 'fake' });

		expect(testBridge.calls).toEqual([{ command: 'app.copy-text', args: { text: 'hello' } }]);
	});

	it('turns what the preload rejected with into a CommandError naming the command', async () => {
		const { platform, invoke, commandFailure } = await freshPort();
		const failures: unknown[] = [
			{
				name: 'GitError',
				message: 'worktree busy: locked',
				code: null,
				kind: 'worktree-busy',
				command: 'repositories.archive-workstream',
			},
			'workstream scope mismatch',
			undefined,
		];
		platform.setPlatformForTest({
			invoke: () => Promise.reject(failures.shift()),
			on: () => () => undefined,
		});

		const wire = await rejectionOf(
			invoke.invoke('repositories.archive-workstream', { workstreamId: 'w' }),
		);
		const text = await rejectionOf(
			invoke.invoke('repositories.workstream-status', { workstreamId: 'w' }),
		);
		const nothing = await rejectionOf(invoke.invoke('app.focus-window', undefined));

		expect(wire).toBeInstanceOf(commandFailure.CommandError);
		expect(wire).toMatchObject({
			name: 'GitError',
			message: 'worktree busy: locked',
			kind: 'worktree-busy',
			command: 'repositories.archive-workstream',
		});
		expect(text).toBeInstanceOf(commandFailure.CommandError);
		expect(text).toMatchObject({
			name: 'Error',
			message: 'workstream scope mismatch',
			command: 'repositories.workstream-status',
		});
		expect(nothing).toMatchObject({
			message: 'app.focus-window failed and gave no reason',
			command: 'app.focus-window',
		});
	});

	it('passes an Error a test bridge threw through untouched', async () => {
		const { platform, invoke } = await freshPort();
		const cause = new Error('network is unreachable');
		platform.setPlatformForTest({ invoke: () => Promise.reject(cause), on: () => () => undefined });

		await expect(invoke.invoke('app.focus-window', undefined)).rejects.toBe(cause);
	});
});

async function freshPort(): Promise<PortModules> {
	vi.resetModules();
	return {
		commandFailure: await import('$contract/command-failure'),
		platform: await import('./platform'),
		invoke: await import('./invoke'),
		events: await import('./events'),
	};
}

function nativeBridge(): FakeBridge {
	const bridge = new FakeBridge();
	bridge.define('app.focus-window', () => undefined);
	bridge.define('app.copy-text', () => undefined);
	return bridge;
}

async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
	try {
		await pending;
	} catch (error) {
		return error;
	}
	throw new Error('the command unexpectedly succeeded');
}
