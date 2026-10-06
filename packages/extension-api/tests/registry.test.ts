import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionRegistry, type ExtensionLifecycleScope } from '../src/registry.js';
import type { ExtensionAPI } from '../src/types.js';

const manifest = {
	schemaVersion: 1,
	id: 'example.registry',
	name: 'Registry',
	version: '1.0.0',
	apiVersion: 1,
	description: 'Registry contract',
	publisher: 'example',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
} as const;

function fakeAPI(partial?: Partial<ExtensionAPI>): ExtensionAPI;
function fakeAPI(partial: Partial<ExtensionAPI> = {}): Partial<ExtensionAPI> {
	return partial;
}

function readExtensionId(payload: unknown): unknown {
	if (typeof payload !== 'object' || payload === null || !('extensionId' in payload)) {
		return undefined;
	}
	return payload.extensionId;
}

test('isolates activation failure and recovers without blocking the registry', async () => {
	const registry = new ExtensionRegistry();
	registry.register({
		manifest,
		module: {
			activate: () => {
				throw new Error('boom');
			},
		},
		createAPI: () => fakeAPI(),
	});
	await assert.rejects(registry.activate(manifest.id), /boom/u);
	assert.equal(registry.get(manifest.id)?.state, 'failed');
	assert.deepEqual(await registry.recover(), []);
	assert.equal(registry.get(manifest.id)?.state, 'inactive');
});

test('rejects duplicate extension ids', () => {
	const registry = new ExtensionRegistry();
	const input = {
		manifest,
		module: { activate: () => undefined },
		createAPI: () => fakeAPI(),
	};
	registry.register(input);
	assert.throws(() => registry.register(input), /Duplicate extension id/u);
});

test('starts healthy extensions when one crashes and can boot in recovery mode', async () => {
	const registry = new ExtensionRegistry();
	let healthyActivations = 0;
	registry.register({
		manifest: { ...manifest, id: 'example.crashes' },
		module: {
			activate: () => {
				throw new Error('crash');
			},
		},
		createAPI: () => fakeAPI(),
	});
	registry.register({
		manifest: { ...manifest, id: 'example.healthy' },
		module: {
			activate: () => {
				healthyActivations += 1;
			},
		},
		createAPI: () => fakeAPI(),
	});

	const report = await registry.activateAll();
	assert.deepEqual(report.activated, ['example.healthy']);
	assert.equal(report.failed.length, 1);
	assert.equal(report.failed[0]?.id, 'example.crashes');
	assert.equal(healthyActivations, 1);

	await registry.deactivate('example.healthy');
	const recovery = await registry.activateAll({ recoveryMode: true });
	assert.deepEqual(recovery.skipped, ['example.crashes', 'example.healthy']);
	assert.equal(healthyActivations, 1);
});

test('cleans host-owned registrations when activation throws before deactivate can run', async () => {
	const registry = new ExtensionRegistry();
	let disposed = 0;
	registry.register({
		manifest,
		module: {
			activate: (api) => {
				api.subscriptions.add({
					dispose: () => {
						disposed += 1;
					},
				});
				throw new Error('activation failed after registration');
			},
		},
		createAPI: (_manifest, lifecycle) =>
			fakeAPI({
				subscriptions: { add: lifecycle.track },
			}),
	});

	await assert.rejects(registry.activate(manifest.id), /activation failed/u);
	assert.equal(disposed, 1);
});

test('emits reload intent and preserves only lifecycle entries marked for reload', async () => {
	const registry = new ExtensionRegistry();
	const events: string[] = [];
	let lifecycle!: ExtensionLifecycleScope;
	let activations = 0;
	let preservedDisposals = 0;
	let ordinaryDisposals = 0;
	registry.register({
		manifest,
		module: {
			activate: () => {
				activations += 1;
				if (activations !== 1) return;
				lifecycle.track(
					{
						dispose: () => {
							preservedDisposals += 1;
						},
					},
					{ preserveOnReload: true },
				);
				lifecycle.track({
					dispose: () => {
						ordinaryDisposals += 1;
					},
				});
			},
			deactivate: () => {
				events.push('deactivate');
			},
		},
		createAPI: (_manifest, scope) => {
			lifecycle = scope;
			return fakeAPI({
				events: {
					on: () => ({ dispose: () => undefined }),
					emit: async (event, payload) => {
						events.push(`${event}:${readExtensionId(payload)}`);
					},
				},
			});
		},
	});

	await registry.activate(manifest.id);
	await registry.reload(manifest.id);
	await registry.reload(manifest.id);
	await registry.reload(manifest.id);
	assert.deepEqual(events, [
		'malini.extension.reloadRequested:example.registry',
		'deactivate',
		'malini.extension.reloadRequested:example.registry',
		'deactivate',
		'malini.extension.reloadRequested:example.registry',
		'deactivate',
	]);
	assert.equal(preservedDisposals, 0);
	assert.equal(ordinaryDisposals, 1);
	assert.equal(activations, 4);
	await registry.deactivate(manifest.id);
	assert.equal(preservedDisposals, 1);
});

test('reload preservation never applies to ordinary deactivation or activation failure', async () => {
	for (const mode of ['deactivate', 'failure'] as const) {
		const registry = new ExtensionRegistry();
		let lifecycle!: ExtensionLifecycleScope;
		let disposed = 0;
		registry.register({
			manifest,
			module: {
				activate: () => {
					lifecycle.track(
						{
							dispose: () => {
								disposed += 1;
							},
						},
						{ preserveOnReload: true },
					);
					if (mode === 'failure') throw new Error('activation failure');
				},
			},
			createAPI: (_manifest, scope) => {
				lifecycle = scope;
				return fakeAPI();
			},
		});

		if (mode === 'failure') await assert.rejects(registry.activate(manifest.id));
		else {
			await registry.activate(manifest.id);
			await registry.deactivate(manifest.id);
		}
		assert.equal(disposed, 1, `${mode} must dispose reload-preserved resources`);
	}
});

test('preserves transition-owned runtime across five alternating disable and reactivation cycles', async () => {
	const registry = new ExtensionRegistry();
	let lifecycle!: ExtensionLifecycleScope;
	let activations = 0;
	let preservedDisposals = 0;
	let ordinaryDisposals = 0;
	const reasons: string[] = [];
	const persistentRuntime = {
		dispose: () => {
			preservedDisposals += 1;
		},
	};
	registry.register({
		manifest,
		module: {
			activate: () => {
				activations += 1;
				lifecycle.track(persistentRuntime, {
					preserveOnReload: true,
					preserveOnWorkstreamTransition: true,
				});
				lifecycle.track({
					dispose: () => {
						ordinaryDisposals += 1;
					},
				});
			},
			deactivate: (reason) => {
				reasons.push(reason);
			},
		},
		createAPI: (_manifest, scope) => {
			lifecycle = scope;
			return fakeAPI();
		},
	});

	await registry.activate(manifest.id);
	for (let cycle = 0; cycle < 5; cycle += 1) {
		await registry.setEnabled(manifest.id, false, 'workstream-transition');
		assert.deepEqual(registry.get(manifest.id), {
			manifest,
			state: 'inactive',
			error: null,
			enabled: false,
		});
		assert.equal(preservedDisposals, 0);
		await registry.setEnabled(manifest.id, true, 'workstream-transition');
		await registry.activate(manifest.id);
	}

	assert.equal(activations, 6);
	assert.equal(ordinaryDisposals, 5);
	assert.deepEqual(
		reasons,
		Array.from({ length: 5 }, () => 'workstream-transition'),
	);
	await registry.deactivate(manifest.id);
	assert.equal(ordinaryDisposals, 6);
	assert.equal(preservedDisposals, 1);
	assert.equal(reasons.at(-1), 'deactivate');
});

test('waits for delayed transition cleanup and retains a failed cleanup for retry', async () => {
	const registry = new ExtensionRegistry();
	let lifecycle!: ExtensionLifecycleScope;
	let enterCleanup!: () => void;
	let releaseCleanup!: () => void;
	const cleanupEntered = new Promise<void>((resolve) => {
		enterCleanup = resolve;
	});
	const cleanupGate = new Promise<void>((resolve) => {
		releaseCleanup = resolve;
	});
	let cleanupAttempts = 0;
	let preservedDisposals = 0;
	const persistentRuntime = {
		dispose: () => {
			preservedDisposals += 1;
		},
	};
	const delayedCleanup = {
		dispose: async () => {
			cleanupAttempts += 1;
			if (cleanupAttempts !== 1) return;
			enterCleanup();
			await cleanupGate;
			throw new Error('transition cleanup failed once');
		},
	};
	registry.register({
		manifest,
		module: {
			activate: () => {
				lifecycle.track(persistentRuntime, {
					preserveOnWorkstreamTransition: true,
				});
				lifecycle.track(delayedCleanup);
			},
		},
		createAPI: (_manifest, scope) => {
			lifecycle = scope;
			return fakeAPI();
		},
	});

	await registry.activate(manifest.id);
	let settled = false;
	const transition = (async () => {
		try {
			await registry.setEnabled(manifest.id, false, 'workstream-transition');
		} finally {
			settled = true;
		}
	})();
	await cleanupEntered;
	assert.equal(settled, false);
	releaseCleanup();
	await assert.rejects(transition, /Failed to clean up extension/u);
	assert.equal(registry.get(manifest.id)?.state, 'failed');
	assert.equal(registry.get(manifest.id)?.enabled, true);
	assert.equal(preservedDisposals, 0);

	await registry.setEnabled(manifest.id, false, 'workstream-transition');
	assert.equal(cleanupAttempts, 2);
	assert.equal(registry.get(manifest.id)?.state, 'inactive');
	assert.equal(registry.get(manifest.id)?.enabled, false);
	assert.equal(preservedDisposals, 0);

	await registry.setEnabled(manifest.id, true);
	await registry.activate(manifest.id);
	await registry.deactivate(manifest.id);
	assert.equal(cleanupAttempts, 3);
	assert.equal(preservedDisposals, 1);
});

test('retries a failed module deactivation before allowing reactivation', async () => {
	const registry = new ExtensionRegistry();
	let activations = 0;
	let deactivationAttempts = 0;
	let moduleOwnership = 0;
	registry.register({
		manifest,
		module: {
			activate: () => {
				assert.equal(moduleOwnership, 0, 'a new controller cannot overwrite failed ownership');
				moduleOwnership = 1;
				activations += 1;
			},
			deactivate: () => {
				deactivationAttempts += 1;
				if (deactivationAttempts === 1) throw new Error('module cleanup failed once');
				moduleOwnership = 0;
			},
		},
		createAPI: () => fakeAPI(),
	});

	await registry.activate(manifest.id);
	await assert.rejects(registry.deactivate(manifest.id), /module cleanup failed once/u);
	assert.equal(registry.get(manifest.id)?.state, 'failed');
	assert.equal(moduleOwnership, 1);

	await registry.activate(manifest.id);
	assert.equal(deactivationAttempts, 2);
	assert.equal(activations, 2);
	assert.equal(moduleOwnership, 1);
	assert.equal(registry.get(manifest.id)?.state, 'active');

	await registry.deactivate(manifest.id);
	assert.equal(moduleOwnership, 0);
});

test('retains a failed cleanup and clears it before retry activation', async () => {
	const registry = new ExtensionRegistry();
	let lifecycle!: ExtensionLifecycleScope;
	let activations = 0;
	let cleanupAttempts = 0;
	registry.register({
		manifest,
		module: {
			activate: () => {
				activations += 1;
				lifecycle.track({
					dispose: () => {
						cleanupAttempts += 1;
						if (cleanupAttempts === 1) throw new Error('native process cleanup failed once');
					},
				});
			},
		},
		createAPI: (_manifest, scope) => {
			lifecycle = scope;
			return fakeAPI();
		},
	});

	await registry.activate(manifest.id);
	await assert.rejects(registry.deactivate(manifest.id), /Failed to clean up extension/u);
	assert.equal(registry.get(manifest.id)?.state, 'failed');

	await registry.activate(manifest.id);
	assert.equal(registry.get(manifest.id)?.state, 'active');
	assert.equal(activations, 2);
	assert.equal(cleanupAttempts, 2);

	await registry.deactivate(manifest.id);
	assert.equal(registry.get(manifest.id)?.state, 'inactive');
	assert.equal(cleanupAttempts, 3);
});
