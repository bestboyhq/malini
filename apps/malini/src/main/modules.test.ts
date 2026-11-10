import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
	app: {
		getPath: () => '/tmp',
		getVersion: () => '0.0.0-test',
		isPackaged: false,
		on: vi.fn(),
		off: vi.fn(),
	},
	session: {
		fromPartition: () => ({
			protocol: { handle: vi.fn() },
			setPermissionRequestHandler: vi.fn(),
			setPermissionCheckHandler: vi.fn(),
		}),
	},
	protocol: { handle: vi.fn() },
}));

import { COMMAND_NAMES } from '../contract/commands';
import { REPOSITORIES_WORKSTREAM_FILES_CHANGED_CHANNEL } from '../contract/events';
import {
	createTestContext,
	writeFakeBridge,
	type TestContext,
} from '$lib/chat/platform/agent/test-support';
import { run } from '$main/db/rows';
import { realGit, workstreamFixture } from '$main/git/fixtures.test-support';
import { workstreamBranchName } from '$main/git/paths';
import { registerModules, type Modules } from './modules';
import { RETIRED_CHATS_PROJECT_ID } from '$shared/repositories/domain/retired-chats';
import { upsertProject } from '$shared/repositories/platform/projects.repository';
import {
	archivedLeftoversCleared,
	checkoutTrashRoot,
} from '$shared/repositories/platform/teardown.service';
import {
	getWorkstream,
	upsertWorkstream,
} from '$shared/repositories/platform/workstreams.repository';
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

function seedRow(
	harness: TestContext,
	workstreamId: string,
	projectId: string,
	base: string,
	checkout: string,
): void {
	const createdAt = '2026-10-01T00:00:00.000Z';
	upsertProject(harness.db, {
		id: projectId,
		name: projectId,
		repoPath: base,
		defaultBranch: 'main',
		createdAt,
	});
	upsertWorkstream(harness.db, {
		id: workstreamId,
		projectId,
		name: workstreamId,
		path: checkout,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt,
		startedBy: null,
	});
}

async function seededWorkstream(
	harness: TestContext,
	workstreamId: string,
	projectId = 'proj',
): Promise<{ base: string; checkout: string }> {
	const fixture = await workstreamFixture(harness.appDataRoot, workstreamId);
	seedRow(harness, workstreamId, projectId, fixture.base, fixture.checkout);
	return fixture;
}

async function seededWorktree(
	harness: TestContext,
	base: string,
	workstreamId: string,
	projectId: string,
): Promise<void> {
	const checkout = join(harness.appDataRoot, 'workstreams', workstreamId);
	await realGit(base, [
		'worktree',
		'add',
		'-q',
		checkout,
		'-b',
		workstreamBranchName(workstreamId),
		'origin/main',
	]);
	seedRow(harness, workstreamId, projectId, base, checkout);
}

async function strandedCheckout(harness: TestContext, workstreamId: string): Promise<string> {
	const { checkout } = await seededWorkstream(harness, workstreamId);
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

	it('archives retired chats once boot has registered the modules teardown needs', async () => {
		const harness = testContext();
		const { base } = await seededWorkstream(harness, 'ws-org', RETIRED_CHATS_PROJECT_ID);
		await seededWorktree(harness, base, 'ws-home', RETIRED_CHATS_PROJECT_ID);
		await seededWorktree(harness, base, 'ws-live', 'proj');
		run(harness.db, "UPDATE workstreams SET scope = 'owner:acme' WHERE id = 'ws-org'");
		run(harness.db, "UPDATE workstreams SET scope = 'home' WHERE id = 'ws-home'");

		await bootModules(harness);

		await vi.waitFor(
			() =>
				expect(['ws-org', 'ws-home'].map((id) => getWorkstream(harness.db, id)?.status)).toEqual([
					'archived',
					'archived',
				]),
			{ timeout: 10_000 },
		);
		expect(getWorkstream(harness.db, 'ws-live')?.status).toBe('active');
	});
});
