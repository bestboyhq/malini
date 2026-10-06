import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
	app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
}));

import { COMMAND_NAMES } from '../contract/commands';
import { REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL } from '../contract/events';
import {
	createTestContext,
	writeFakeBridge,
	type TestContext,
} from '$lib/chat/platform/agent/test-support';
import { workstreamFixture } from '$main/git/fixtures.test-support';
import { registerModules, type Modules } from './modules';
import { upsertProject } from '$shared/repositories/platform/projects.repository';
import {
	archivedLeftoversCleared,
	checkoutTrashRoot,
} from '$shared/repositories/platform/teardown.service';
import { upsertWorkstream } from '$shared/repositories/platform/workstreams.repository';
import { createFakeHost } from '$lib/app/platform/test-support';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

function testContext(): TestContext {
	const harness = createTestContext();
	cleanups.push(() => harness.cleanup());
	return harness;
}

async function bootModules(
	harness = testContext(),
): Promise<{ modules: Modules; names: string[] }> {
	const bridge = writeFakeBridge();
	cleanups.push(() => bridge.cleanup());
	const modules = await registerModules(harness.context, {
		getMainWindow: () => null,
		overrides: {
			shellHost: createFakeHost(),
			filePicker: { pickFiles: () => Promise.resolve([]) },
			bridgeScriptPath: bridge.scriptPath,
			startupReclaim: false,
			log: () => {},
		},
	});
	cleanups.push(archivedLeftoversCleared, () => modules.shutdown());
	return { modules, names: harness.context.commands.names() };
}

async function strandedCheckout(harness: TestContext, workstreamId: string): Promise<string> {
	const { base, checkout } = await workstreamFixture(harness.appDataRoot, workstreamId);
	const createdAt = '2026-10-01T00:00:00.000Z';
	upsertProject(harness.db, {
		id: 'proj',
		name: 'proj',
		repoPath: base,
		defaultBranch: 'main',
		createdAt,
	});
	upsertWorkstream(harness.db, {
		id: workstreamId,
		projectId: 'proj',
		name: workstreamId,
		path: checkout,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt,
	});
	await mkdir(checkoutTrashRoot(harness.appDataRoot), { recursive: true });
	await rename(
		checkout,
		join(checkoutTrashRoot(harness.appDataRoot), `${workstreamId}-1790000000000`),
	);
	return checkout;
}

describe('the main module graph', () => {
	it('registers exactly the commands the contract declares', async () => {
		const { names } = await bootModules();
		expect(names).toEqual([...COMMAND_NAMES].sort());
	});

	it('watches a live workstream whose checkout boot moved back from the trash', async () => {
		const harness = testContext();
		const checkout = await strandedCheckout(harness, 'ws-stranded');
		const changed: string[] = [];
		harness.events.subscribe(REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL, (payload) => {
			const workstreamId: unknown = Reflect.get(Object(payload), 'workstreamId');
			if (typeof workstreamId === 'string') changed.push(workstreamId);
		});

		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		cleanups.push(() => warned.mockRestore());

		const { modules } = await bootModules(harness);
		expect(warned).toHaveBeenCalledWith(
			`malini: moved the checkout of a live workstream back to \`${checkout}\``,
		);
		await vi.waitFor(
			() => expect(modules.repositories.watchers.isWatching('ws-stranded')).toBe(true),
			{ timeout: 2_000 },
		);
		let writes = 0;
		await vi.waitFor(
			async () => {
				writes += 1;
				await writeFile(join(checkout, `after-boot-${writes}.txt`), 'written after boot\n');
				expect(changed).toContain('ws-stranded');
			},
			{ timeout: 10_000, interval: 500 },
		);
	});
});
