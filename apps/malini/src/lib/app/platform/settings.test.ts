import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	app: {},
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { DockerOwnership } from '$main/docker/ownership';
import { openMigratedDatabase } from '$main/db/open';
import { ScriptedRunner } from '$main/process/test-support';
import { registerApp } from './register';
import { getSetting, listSettings, setSetting } from './settings.repository';
import { createFakeHost, createTestContext } from './test-support';

function boot() {
	const context = createTestContext('/unused', { db: openMigratedDatabase(':memory:') });
	registerApp(context, {
		getMainWindow: () => null,
		host: createFakeHost(),
		ownership: new DockerOwnership({
			db: context.db,
			runner: new ScriptedRunner(),
			appDataRoot: context.appDataRoot,
			bundleIdentifier: 'app.malini.desktop.dev',
		}),
	});
	const invoke = async (command: string, args: unknown = {}): Promise<unknown> => {
		const response = await context.commands.invoke({ command, args });
		if (!response.ok) throw new Error(response.error);
		return response.value;
	};
	return { invoke, db: context.db };
}

describe('the settings commands', () => {
	it('round-trips through the settings table', async () => {
		const { invoke, db } = boot();
		expect(await invoke('app.list-settings')).toEqual({});
		await invoke('app.set-setting', { key: 'default_check_command', value: 'pnpm test' });
		await invoke('app.set-setting', { key: 'a', value: '1' });
		await invoke('app.set-setting', { key: 'a', value: '2' });
		expect(await invoke('app.list-settings')).toEqual({
			a: '2',
			default_check_command: 'pnpm test',
		});
		await expect(invoke('app.set-setting', { key: 'x' })).rejects.toThrow(
			'invalid args: `value` must be a string',
		);
		db.close();
	});
});

describe('the settings repository', () => {
	it('round-trips and lists as a record', () => {
		const db = openMigratedDatabase(':memory:');
		expect(getSetting(db, 'theme')).toBeNull();
		setSetting(db, 'theme', 'dark');
		setSetting(db, 'theme', 'light');
		setSetting(db, 'agent.model', 'anthropic/claude-sonnet-4-6');
		expect(getSetting(db, 'theme')).toBe('light');
		expect(listSettings(db)).toEqual({
			'agent.model': 'anthropic/claude-sonnet-4-6',
			theme: 'light',
		});
		db.close();
	});
});
