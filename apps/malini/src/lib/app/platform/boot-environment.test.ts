import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { resolveBootEnvironment } from './boot-environment';
import { createTestContext } from './test-support';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()?.();
});

describe('resolveBootEnvironment', () => {
	it('defines no commands and writes the diagnostics record', async () => {
		const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-app-boot-'));
		cleanups.push(() => rmSync(appDataRoot, { recursive: true, force: true }));
		const context = createTestContext(appDataRoot);
		cleanups.push(() => context.db.close());

		const environment = await resolveBootEnvironment(context);

		expect(context.commands.names()).toEqual([]);
		expect(environment.path).toContain('/usr/bin');
		const diagnostics: unknown = JSON.parse(
			readFileSync(join(appDataRoot, 'diagnostics', 'environment.json'), 'utf8'),
		);
		expect(diagnostics).toMatchObject({
			schemaVersion: 1,
			path: expect.stringContaining('/usr/bin'),
		});
	});
});
