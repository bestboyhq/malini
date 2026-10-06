import { mkdtemp, rm, writeFile as writeBytes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import { openDatabase } from '$main/db/driver';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerExtensions } from './register';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';

let root: string;
let context: MainContext;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'malini-ext-host-'));
	const resolver: CheckoutResolver = {
		resolveCheckout: async (id) => {
			if (id !== 'workstream-1') throw new Error(`Unknown extension workstream: ${id}`);
			return root;
		},
		resolveRepositoryRoot: async (id) => {
			if (id !== 'workstream-1') throw new Error(`Unknown extension workstream: ${id}`);
			return root;
		},
	};
	const events = createEventBus({ forwardToWindows: false });
	context = {
		db: openDatabase(':memory:'),
		commands: new CommandRegistry(),
		events,
		appDataRoot: root,
		resourcesRoot: root,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	registerExtensions(context, { resolver });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

async function invokeError(command: string, args: unknown = {}): Promise<string> {
	const response = await context.commands.invoke({ command, args });
	if (response.ok) throw new Error(`${command} unexpectedly succeeded`);
	return response.error;
}

describe('registerExtensions', () => {
	it('defines the five workstream file commands the renderer platform port invokes', () => {
		expect(
			context.commands.names().filter((name) => name.endsWith('-file') || name.endsWith('-files')),
		).toEqual([
			'extensions.list-workstream-files',
			'extensions.read-repository-file',
			'extensions.read-workstream-file',
			'extensions.stat-workstream-file',
			'extensions.write-workstream-file',
		]);
	});

	it('round-trips workstream files through the resolver', async () => {
		const owner = { extensionId: 'malini.repository', workstreamId: 'workstream-1' };
		await invoke('extensions.write-workstream-file', {
			...owner,
			path: '.malini/workspace.json',
			contents: '{"a":1}',
		});
		await expect(
			invoke('extensions.read-workstream-file', { ...owner, path: '.malini/workspace.json' }),
		).resolves.toBe('{"a":1}');
		await expect(
			invoke('extensions.stat-workstream-file', { ...owner, path: '.malini/workspace.json' }),
		).resolves.toEqual({ kind: 'file', size: 7 });
		await expect(
			invoke('extensions.stat-workstream-file', { ...owner, path: 'nope' }),
		).resolves.toBeNull();
		await writeBytes(join(root, 'README.md'), '# hi');
		await expect(invoke('extensions.list-workstream-files', owner)).resolves.toEqual([
			'.malini/workspace.json',
			'README.md',
		]);
		await expect(
			invoke('extensions.list-workstream-files', { ...owner, glob: '**/*.json' }),
		).resolves.toEqual(['.malini/workspace.json']);
		await expect(
			invoke('extensions.read-repository-file', { ...owner, path: 'README.md' }),
		).resolves.toBe('# hi');

		expect(await invokeError('extensions.read-workstream-file', { ...owner, path: '../x' })).toBe(
			'Extension workstream path must stay relative to its workstream: ../x',
		);
		expect(
			await invokeError('extensions.read-workstream-file', {
				...owner,
				workstreamId: 'workstream-9',
				path: 'x',
			}),
		).toBe('Unknown extension workstream: workstream-9');
		expect(
			await invokeError('extensions.read-workstream-file', {
				extensionId: '',
				workstreamId: 'w',
				path: 'x',
			}),
		).toBe('Extension filesystem access requires an extension id');
		expect(await invokeError('extensions.list-workstream-files', { extensionId: 'e' })).toBe(
			'Extension filesystem access requires a workstream id',
		);
	});
});
