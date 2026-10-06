import type { ExtensionAPI, ExtensionManifest, ExtensionModule } from '@malini/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionSourceSnapshot } from '$contract/system';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import type { PlatformSeed } from '$shared/port/fake/seed';
import { setPlatformForTest } from '$shared/port/platform';

import { LocalExtensions } from './local-extensions';

afterEach(() => {
	setPlatformForTest(null);
});

function installFake(seed: PlatformSeed = {}): FakePlatform {
	const fake = createFakePlatform(seed);
	setPlatformForTest(fake);
	return fake;
}

function source(
	id: string,
	revision = 1,
	overrides: Partial<ExtensionSourceSnapshot> = {},
): ExtensionSourceSnapshot {
	return {
		id,
		sourceKind: 'local',
		sourcePath: `/extensions/${id}`,
		enabled: true,
		watch: true,
		manifestJson: JSON.stringify({
			schemaVersion: 1,
			id,
			name: id,
			version: '1.0.0',
			apiVersion: 1,
			description: `${id} fixture`,
			publisher: 'Community',
			entrypoint: './extension.mjs',
			activationEvents: ['onStartup'],
		}),
		entrypointSource: `revision ${revision}`,
		fingerprint: `fingerprint-${revision}`,
		reloadSequence: 0,
		loadError: null,
		...overrides,
	};
}

function unsupported(): never {
	throw new Error('These local extension tests never call the host API');
}

function extensionAPI(manifest: ExtensionManifest): ExtensionAPI {
	return {
		manifest,
		workstream: {
			current: unsupported,
			listFiles: unsupported,
			readFile: unsupported,
			writeFile: unsupported,
			stat: unsupported,
		},
		repository: {
			status: unsupported,
			diff: unsupported,
			pullRequest: unsupported,
			createPullRequest: unsupported,
			refresh: unsupported,
			commit: unsupported,
			push: unsupported,
			pullLatest: unsupported,
		},
		panels: { register: unsupported, open: unsupported },
		commands: { register: unsupported, execute: unsupported },
		settings: {
			register: unsupported,
			get: unsupported,
			set: unsupported,
			onDidChange: unsupported,
		},
		state: { get: unsupported, set: unsupported, delete: unsupported },
		workflows: { register: unsupported },
		events: { on: unsupported, emit: unsupported },
		notifications: { show: unsupported },
		clock: { now: unsupported, sleep: unsupported },
		ids: { next: unsupported },
		ui: { openExternal: unsupported },
		secrets: { get: unsupported, set: unsupported, delete: unsupported },
		subscriptions: { add: unsupported },
	};
}

describe('LocalExtensions', () => {
	it('imports a self-contained local entrypoint at runtime without an app source edit', async () => {
		installFake({
			extensionSources: [
				source('community.scaffolded', 1, {
					entrypointSource: 'export default { activate() {} };',
				}),
			],
		});
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			pollIntervalMs: 60_000,
		});
		const report = await runtime.start();
		expect(report.activated).toEqual(['community.scaffolded']);
		expect(report.failed).toEqual([]);
		await runtime.stop();
	});

	it('loads a scaffolded source without any app-side registration and isolates a crash', async () => {
		installFake({
			extensionSources: [source('community.healthy'), source('community.crashes')],
		});
		const activated: string[] = [];
		const importer = vi.fn(async (snapshot: ExtensionSourceSnapshot): Promise<ExtensionModule> => ({
			activate() {
				if (snapshot.id === 'community.crashes') throw new Error('extension crash');
				activated.push(snapshot.id);
			},
		}));
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: importer,
			pollIntervalMs: 60_000,
		});
		const report = await runtime.start();
		expect(report.activated).toEqual(['community.healthy']);
		expect(report.failed.map(({ id }) => id)).toEqual(['community.crashes']);
		expect(activated).toEqual(['community.healthy']);
		expect(importer).toHaveBeenCalledTimes(2);
		await runtime.sync();
		expect(importer).toHaveBeenCalledTimes(2);
		await runtime.stop();
	});

	it('reloads changed source exactly once and deactivates the prior module first', async () => {
		const platform = installFake({ extensionSources: [source('community.reload')] });
		const events: string[] = [];
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: async (snapshot) => ({
				activate: () => {
					events.push(`activate:${snapshot.fingerprint}`);
				},
				deactivate: () => {
					events.push(`deactivate:${snapshot.fingerprint}`);
				},
			}),
			pollIntervalMs: 60_000,
		});
		await runtime.start();
		platform.seed({ extensionSources: [source('community.reload', 2)] });
		await runtime.sync();
		await runtime.sync();
		expect(events).toEqual([
			'activate:fingerprint-1',
			'deactivate:fingerprint-1',
			'activate:fingerprint-2',
		]);
		await runtime.stop();
	});

	it('keeps the last healthy module active while changed source is invalid', async () => {
		const platform = installFake({ extensionSources: [source('community.stable')] });
		const events: string[] = [];
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: async (snapshot) => ({
				activate() {
					events.push(`activate:${snapshot.fingerprint}`);
				},
				deactivate() {
					events.push(`deactivate:${snapshot.fingerprint}`);
				},
			}),
			pollIntervalMs: 60_000,
		});
		await runtime.start();
		platform.seed({
			extensionSources: [source('community.stable', 2, { loadError: 'partial build' })],
		});
		await runtime.sync();
		await runtime.sync();
		expect(events).toEqual(['activate:fingerprint-1']);
		expect(runtime.list().map(({ state }) => state)).toEqual(['active']);
		await runtime.stop();
	});

	it('requires an explicit reload sequence when folder watch is disabled', async () => {
		const platform = installFake({
			extensionSources: [source('community.manual', 1, { watch: false })],
		});
		const activations: string[] = [];
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: async (snapshot) => ({
				activate() {
					activations.push(snapshot.fingerprint);
				},
			}),
			pollIntervalMs: 60_000,
		});
		await runtime.start();
		platform.seed({ extensionSources: [source('community.manual', 2, { watch: false })] });
		await runtime.sync();
		expect(activations).toEqual(['fingerprint-1']);
		platform.seed({
			extensionSources: [source('community.manual', 2, { watch: false, reloadSequence: 1 })],
		});
		await runtime.sync();
		expect(activations).toEqual(['fingerprint-1', 'fingerprint-2']);
		await runtime.stop();
	});

	it('keeps every community package inactive in recovery mode', async () => {
		installFake({
			extensionSources: [source('community.skipped')],
			extensionRecoveryMode: true,
		});
		const importer = vi.fn();
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: importer,
		});
		const report = await runtime.start();
		expect(report.skipped).toEqual(['community.skipped']);
		expect(importer).not.toHaveBeenCalled();
		await runtime.stop();
	});

	it('starts recovery mode even when the community registry cannot be read', async () => {
		const platform = installFake({ extensionRecoveryMode: true });
		platform.define('extensions.list-sources', async () => {
			throw new Error('corrupt local.json');
		});
		const importer = vi.fn();
		const runtime = new LocalExtensions({
			createAPI: extensionAPI,
			importSource: importer,
		});

		await expect(runtime.start()).resolves.toEqual({ activated: [], failed: [], skipped: [] });
		expect(importer).not.toHaveBeenCalled();
		expect(platform.calls.map(({ command }) => command)).toContain(
			'extensions.append-development-log',
		);
		await runtime.stop();
	});

	it('never queues additional poll cycles while one source sync is pending', async () => {
		vi.useFakeTimers();
		try {
			const platform = installFake({ extensionSources: [] });
			let release!: (sources: ExtensionSourceSnapshot[]) => void;
			const pending = new Promise<ExtensionSourceSnapshot[]>((resolvePromise) => {
				release = resolvePromise;
			});
			const listSources = vi
				.fn<() => Promise<ExtensionSourceSnapshot[]>>()
				.mockResolvedValueOnce([])
				.mockImplementationOnce(() => pending)
				.mockResolvedValue([]);
			platform.define('extensions.list-sources', listSources);
			const runtime = new LocalExtensions({
				createAPI: extensionAPI,
				pollIntervalMs: 10,
			});
			await runtime.start();
			await vi.advanceTimersByTimeAsync(10);
			expect(listSources).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(listSources).toHaveBeenCalledTimes(2);

			release([]);
			await vi.advanceTimersByTimeAsync(0);
			expect(listSources).toHaveBeenCalledTimes(2);
			await runtime.stop();
		} finally {
			vi.useRealTimers();
		}
	});
});
