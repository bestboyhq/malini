import { describe, expect, it, vi } from 'vitest';
import { AgentSessionPreactivationCoordinator } from './agent-session-preactivation';

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

describe('AgentSessionPreactivationCoordinator', () => {
	it('bounds speculative bridge registrations to one at a time', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator(1);
		const first = deferred();
		const second = deferred();
		const started: string[] = [];
		const activate = (sessionId: string): Promise<void> => {
			started.push(sessionId);
			return sessionId === 'session-a' ? first.promise : second.promise;
		};

		const firstWarmup = coordinator.preactivate('session-a', activate);
		const secondWarmup = coordinator.preactivate('session-b', activate);
		await Promise.resolve();
		expect(started).toEqual(['session-a']);

		first.resolve();
		await firstWarmup;
		await Promise.resolve();
		expect(started).toEqual(['session-a', 'session-b']);
		second.resolve();
		await secondWarmup;
	});

	it('joins a foreground activation to the same running preactivation', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator();
		const activation = deferred();
		const background = vi.fn(() => activation.promise);
		const foreground = vi.fn(async () => undefined);

		const warmup = coordinator.preactivate('session-a', background);
		await Promise.resolve();
		const navigation = coordinator.activateForeground('session-a', foreground);

		expect(background).toHaveBeenCalledTimes(1);
		expect(foreground).not.toHaveBeenCalled();
		activation.resolve();
		await expect(Promise.all([warmup, navigation])).resolves.toEqual([undefined, undefined]);
	});

	it('promotes a queued target immediately when navigation needs it', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator(1);
		const unrelated = deferred();
		const promoted = deferred();
		const backgroundB = vi.fn(async () => undefined);
		const foregroundB = vi.fn(() => promoted.promise);

		const warmupA = coordinator.preactivate('session-a', () => unrelated.promise);
		const warmupB = coordinator.preactivate('session-b', backgroundB);
		await Promise.resolve();
		const navigationB = coordinator.activateForeground('session-b', foregroundB);
		await Promise.resolve();

		expect(foregroundB).toHaveBeenCalledWith('session-b');
		expect(backgroundB).not.toHaveBeenCalled();
		promoted.resolve();
		await expect(Promise.all([warmupB, navigationB])).resolves.toEqual([undefined, undefined]);
		unrelated.resolve();
		await warmupA;
	});

	it('removes failed flights so an explicit foreground retry reaches native activation', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator();
		const activate = vi
			.fn<(sessionId: string) => Promise<void>>()
			.mockRejectedValueOnce(new Error('bridge unavailable'))
			.mockResolvedValueOnce(undefined);

		await expect(coordinator.preactivate('session-a', activate)).rejects.toThrow(
			'bridge unavailable',
		);
		await expect(coordinator.activateForeground('session-a', activate)).resolves.toBeUndefined();
		expect(activate).toHaveBeenCalledTimes(2);
	});

	it('does not cache success across foreground calls so native bridge recovery still runs', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator();
		const activate = vi.fn(async () => undefined);

		await coordinator.preactivate('session-a', activate);
		await coordinator.activateForeground('session-a', activate);
		await coordinator.activateForeground('session-a', activate);

		expect(activate).toHaveBeenCalledTimes(3);
	});

	it('retires queued work from an obsolete route generation', async () => {
		const coordinator = new AgentSessionPreactivationCoordinator(1);
		const first = deferred();
		const cancelledActivation = vi.fn(async () => undefined);
		const controller = new AbortController();

		const warmupA = coordinator.preactivate('session-a', () => first.promise);
		const warmupB = coordinator.preactivate('session-b', cancelledActivation, {
			signal: controller.signal,
		});
		controller.abort();
		await expect(warmupB).resolves.toBeUndefined();
		first.resolve();
		await warmupA;
		await Promise.resolve();

		expect(cancelledActivation).not.toHaveBeenCalled();
	});
});
