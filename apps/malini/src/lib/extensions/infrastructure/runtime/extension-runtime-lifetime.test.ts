import { describe, expect, it, vi } from 'vitest';

import { ExtensionRuntimeLifetime } from './extension-runtime-lifetime';
import { ExtensionRuntimeCoordinator } from './extension-runtime-coordinator';

describe('ExtensionRuntimeLifetime', () => {
	it('reuses the app runtime when a replacement layout arrives before deferred teardown', async () => {
		const releaseDelay = deferred<void>();
		const coordinators: ExtensionRuntimeCoordinator[] = [];
		const stops: Array<ReturnType<typeof vi.spyOn>> = [];
		const lifetime = new ExtensionRuntimeLifetime({
			create: (startupBarrier) => {
				const coordinator = new ExtensionRuntimeCoordinator(startupBarrier);
				coordinators.push(coordinator);
				stops.push(vi.spyOn(coordinator, 'stop'));
				return coordinator;
			},
			deferRelease: () => releaseDelay.promise,
		});

		const first = lifetime.acquire();
		const releasing = first.release();
		const replacement = lifetime.acquire();
		releaseDelay.resolve();
		await releasing;

		expect(replacement.coordinator).toBe(first.coordinator);
		expect(coordinators).toHaveLength(1);
		expect(stops[0]).not.toHaveBeenCalled();

		await replacement.release();
		expect(stops[0]).toHaveBeenCalledOnce();
	});

	it('blocks a later runtime generation until an in-progress predecessor shutdown settles', async () => {
		const releaseDelay = deferred<void>();
		const predecessorStop = deferred<void>();
		const predecessorStopStarted = deferred<void>();
		let creationCount = 0;
		const lifetime = new ExtensionRuntimeLifetime({
			create: (startupBarrier) => {
				const coordinator = new ExtensionRuntimeCoordinator(startupBarrier);
				creationCount += 1;
				if (creationCount === 1) {
					vi.spyOn(coordinator, 'stop').mockImplementation(() => {
						predecessorStopStarted.resolve();
						return predecessorStop.promise;
					});
				}
				return coordinator;
			},
			deferRelease: () => releaseDelay.promise,
		});

		const first = lifetime.acquire();
		const releasing = first.release();
		releaseDelay.resolve();
		await predecessorStopStarted.promise;

		const replacement = lifetime.acquire();
		expect(replacement.coordinator).not.toBe(first.coordinator);
		let replacementReady = false;
		const replacementIdle = (async () => {
			await replacement.coordinator.whenIdle();
			replacementReady = true;
		})();
		await Promise.resolve();
		expect(replacementReady).toBe(false);

		predecessorStop.resolve();
		await releasing;
		await replacementIdle;
		expect(replacementReady).toBe(true);
		await release(replacement);
	});
});

type ExtensionRuntimeLease = ReturnType<ExtensionRuntimeLifetime['acquire']>;

async function release(lease: ExtensionRuntimeLease): Promise<void> {
	await lease.release();
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
