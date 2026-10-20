import { describe, expect, it } from 'vitest';
import { settleConcurrentSessionPreparation } from './session-bootstrap-concurrency';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

describe('settleConcurrentSessionPreparation', () => {
	it('starts every independent operation before waiting and preserves task result order', async () => {
		const activation = deferred<string>();
		const hydration = deferred<string>();
		const routeSync = deferred<string>();
		const started: string[] = [];

		const preparation = settleConcurrentSessionPreparation([
			() => {
				started.push('activate');
				return activation.promise;
			},
			() => {
				started.push('hydrate');
				return hydration.promise;
			},
			() => {
				started.push('sync-route');
				return routeSync.promise;
			},
		]);

		expect(started).toEqual(['activate', 'hydrate', 'sync-route']);
		routeSync.resolve('route');
		hydration.resolve('history');
		activation.resolve('runtime');

		await expect(preparation).resolves.toEqual(['runtime', 'history', 'route']);
	});

	it('keeps the readiness barrier pending until every task settles after one fails', async () => {
		const activation = deferred<void>();
		const hydration = deferred<void>();
		let observedFailure = false;
		const preparation = settleConcurrentSessionPreparation([
			() => activation.promise,
			() => hydration.promise,
		]);
		const observed = preparation.catch((error: unknown) => {
			observedFailure = true;
			throw error;
		});

		activation.reject(new Error('activation failed'));
		await Promise.resolve();
		expect(observedFailure).toBe(false);

		hydration.resolve();
		await expect(observed).rejects.toThrow('activation failed');
		expect(observedFailure).toBe(true);
	});
});
