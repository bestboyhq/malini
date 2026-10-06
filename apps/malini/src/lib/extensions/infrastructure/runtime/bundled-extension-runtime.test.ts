import type { ExtensionManifest } from '@malini/extension-api';
import { describe, expect, it } from 'vitest';

import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';
import { DesktopExtensionHost } from '../host/extension-host';
import type { bundledExtensions } from './bundled-extensions';
import { BundledExtensionRuntime } from './bundled-extension-runtime';

type BundledExtension = (typeof bundledExtensions)[number];

const manifest = (id: string): ExtensionManifest => ({
	schemaVersion: 1,
	id,
	name: id,
	version: '1.0.0',
	apiVersion: 1,
	description: `${id} test extension`,
	publisher: 'malini',
	entrypoint: './dist/index.js',
	activationEvents: ['onStartup'],
});

function createAPI(): DesktopExtensionHost['createAPI'] {
	const settings = new Map<string, string>();
	const host = new DesktopExtensionHost({
		workstream: () => null,
		workstreamSnapshots: workstreamSnapshotsHook(),
		stateStorage: null,
		settingStorage: {
			get: (key) => settings.get(key) ?? null,
			set: (key, value) => {
				settings.set(key, value);
			},
			delete: (key) => {
				settings.delete(key);
			},
		},
	});
	return host.createAPI;
}

describe('BundledExtensionRuntime', () => {
	it('keeps workstream-configured packages disabled until the repository enables them', async () => {
		const activated: string[] = [];
		const extensions: readonly BundledExtension[] = [
			{
				manifest: manifest('example.primitive'),
				module: {
					activate: () => {
						activated.push('example.primitive');
					},
				},
				trusted: true,
				activation: 'built-in',
			},
			{
				manifest: manifest('example.custom'),
				module: {
					activate: () => {
						activated.push('example.custom');
					},
				},
				trusted: true,
				activation: 'workstream',
			},
		];
		const runtime = new BundledExtensionRuntime({ extensions, createAPI: createAPI() });
		const initial = await runtime.start();
		expect(initial.activated).toEqual(['example.primitive']);
		expect(initial.skipped).toEqual(['example.custom']);
		expect(activated).toEqual(['example.primitive']);

		const configured = await runtime.setWorkstreamEnabled(new Set(['example.custom']));
		expect(configured.activated).toEqual(['example.custom']);
		expect(activated).toEqual(['example.primitive', 'example.custom']);
		await runtime.stop();
	});

	it('isolates a crashing package and still activates the next one', async () => {
		const activated: string[] = [];
		const extensions: readonly BundledExtension[] = [
			{
				manifest: manifest('example.crashes'),
				module: {
					activate: () => {
						throw new Error('crash');
					},
				},
				trusted: true,
				activation: 'built-in',
			},
			{
				manifest: manifest('example.healthy'),
				module: {
					activate: () => {
						activated.push('example.healthy');
					},
				},
				trusted: true,
				activation: 'built-in',
			},
		];
		const runtime = new BundledExtensionRuntime({ extensions, createAPI: createAPI() });
		const report = await runtime.start();
		expect(report.activated).toEqual(['example.healthy']);
		expect(report.failed.map(({ id }) => id)).toEqual(['example.crashes']);
		expect(activated).toEqual(['example.healthy']);
		await runtime.stop();
	});

	it('starts in recovery mode without invoking any package', async () => {
		let activations = 0;
		const extensions: readonly BundledExtension[] = [
			{
				manifest: manifest('example.skipped'),
				module: {
					activate: () => {
						activations += 1;
					},
				},
				trusted: true,
				activation: 'workstream',
			},
		];
		const runtime = new BundledExtensionRuntime({ extensions, createAPI: createAPI() });
		const report = await runtime.start({ recoveryMode: true });
		expect(report.skipped).toEqual(['example.skipped']);
		expect(activations).toBe(0);
		await runtime.stop();
	});
});
