import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import { openDatabase } from '$main/db/driver';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { InvokeResponse } from '$contract/ipc';
import type { ExtensionsPlatform } from '../extensions.platform';
import { registerExtensions } from './register';
import type { BestboyAccess } from '$lib/stats/stats.platform';
const offlineBestboy = (): BestboyAccess => ({
	origin: 'https://bestboy.test',
	fetch: () => Promise.reject(new Error('offline')),
	session: () => null,
	signIn: () => undefined,
	claimHandle: () => Promise.resolve(null),
	signedOut: () => Promise.resolve(),
});

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function boot(): { context: MainContext; runtime: ExtensionsPlatform; root: string } {
	const root = mkdtempSync(join(tmpdir(), 'malini-extension-runtime-'));
	const appDataRoot = join(root, 'data');
	const resourcesRoot = join(root, 'resources');
	mkdirSync(appDataRoot, { recursive: true });
	mkdirSync(resourcesRoot, { recursive: true });
	const db = openDatabase(':memory:');
	const context: MainContext = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot,
		resourcesRoot,
		isDev: true,
		appVersion: '0.1.0-test',
	};
	const runtime = registerExtensions(context, {
		resolver: {
			resolveCheckout: () => Promise.resolve(root),
			resolveRepositoryRoot: () => Promise.resolve(root),
		},
		readCheckout: (_id, read) => read(root),
		bestboy: offlineBestboy,
	});
	cleanups.push(() => {
		db.close();
		rmSync(root, { recursive: true, force: true });
	});
	return { context, runtime, root };
}

function value(response: InvokeResponse): unknown {
	if (!response.ok) throw new Error(`command failed: ${response.error}`);
	return response.value;
}

function failure(response: InvokeResponse): string {
	if (response.ok)
		throw new Error(`command unexpectedly succeeded with ${JSON.stringify(response.value)}`);
	return response.error;
}

describe('extensions platform packages', () => {
	it('registers every command the renderer platform port invokes', () => {
		const { context } = boot();
		expect(context.commands.names()).toEqual([
			'extensions.append-development-log',
			'extensions.claim-handle',
			'extensions.get-listing',
			'extensions.install',
			'extensions.list-installed',
			'extensions.list-listings',
			'extensions.list-sources',
			'extensions.list-workstream-files',
			'extensions.publish',
			'extensions.publishing',
			'extensions.read-repository-file',
			'extensions.read-workstream-file',
			'extensions.recovery-mode-enabled',
			'extensions.sign-in',
			'extensions.stat-workstream-file',
			'extensions.switch',
			'extensions.uninstall',
			'extensions.write-workstream-file',
		]);
	});

	it('lists no local sources until a development folder registers one', async () => {
		const { context } = boot();
		expect(
			value(await context.commands.invoke({ command: 'extensions.list-sources', args: {} })),
		).toEqual([]);
	});

	it('reads recovery mode and appends development logs under the app data root', async () => {
		const { context } = boot();
		const invoke = (command: string, args: unknown = {}) =>
			context.commands.invoke({ command, args });
		expect(value(await invoke('extensions.recovery-mode-enabled'))).toBe(false);
		expect(
			await invoke('extensions.append-development-log', {
				log: {
					timestamp: '2026-09-18T00:00:00Z',
					level: 'info',
					extensionId: null,
					event: 'started',
					message: 'hello',
				},
			}),
		).toEqual({ ok: true, value: null });
		expect(failure(await invoke('extensions.append-development-log', { log: { level: 1 } }))).toBe(
			'extensions.append-development-log received a malformed log',
		);
	});
});
