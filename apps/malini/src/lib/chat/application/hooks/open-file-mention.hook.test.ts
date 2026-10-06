import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
import { openFileMentionHook } from '$lib/chat/application/hooks/open-file-mention.hook';
import type { RepositoryFileTarget } from '$lib/chat/domain/repository-file-target';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

const WORKSTREAM = 'ws-mentions';

const disconnects: Array<() => void> = [];

afterEach(() => {
	for (const disconnect of disconnects.splice(0)) disconnect();
	workstreamFilesAggregate.reset();
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

function installRepository(): { platform: FakePlatform; opened: unknown[] } {
	const platform = createFakePlatform({
		workstreamFiles: {
			[WORKSTREAM]: [
				'README.md',
				'src/git/remote.ts',
				'src/git/credentials.ts',
				'packages/a/index.ts',
				'packages/b/index.ts',
			],
		},
	});
	setPlatformForTest(platform);
	const opened: unknown[] = [];
	disconnects.push(
		extensionCommands.connect({
			workstreamId: () => WORKSTREAM,
			execute: async (command, input) => {
				opened.push({ command, input });
			},
			emit: async () => undefined,
			onEvent: () => () => undefined,
		}),
	);
	return { platform, opened };
}

async function listed(): Promise<void> {
	loadWorkstreamFilesCommand(WORKSTREAM);
	await vi.waitFor(() => expect(workstreamFilesAggregate.listing?.status).toBe('ready'));
}

function clickMention(
	target: RepositoryFileTarget,
): (targets: readonly RepositoryFileTarget[]) => void {
	const choose = vi.fn<(targets: readonly RepositoryFileTarget[]) => void>();
	openFileMentionHook(() => WORKSTREAM)(target, choose);
	return choose;
}

function openCommand(path: string, line: number | null = null): unknown {
	return { command: 'malini.repository.open-file', input: { path, line } };
}

describe('opening a file a chat message named', () => {
	it('opens a file named by its whole path', async () => {
		const { opened } = installRepository();
		await listed();

		clickMention({ path: 'README.md', line: null });

		await vi.waitFor(() => expect(opened).toEqual([openCommand('README.md')]));
	});

	it('opens the one nested file a bare name means, at the line the message named', async () => {
		const { opened } = installRepository();
		await listed();

		clickMention({ path: 'remote.ts', line: 42 });
		clickMention({ path: 'git/credentials.ts', line: null });

		await vi.waitFor(() =>
			expect(opened).toEqual([
				openCommand('src/git/remote.ts', 42),
				openCommand('src/git/credentials.ts'),
			]),
		);
	});

	it('offers every file a shared name could mean and opens none of them yet', async () => {
		const { opened } = installRepository();
		await listed();

		const choose = clickMention({ path: 'index.ts', line: 3 });

		await vi.waitFor(() =>
			expect(choose).toHaveBeenCalledWith([
				{ path: 'packages/a/index.ts', line: 3 },
				{ path: 'packages/b/index.ts', line: 3 },
			]),
		);
		expect(opened).toEqual([]);
	});

	it('says calmly that no file has the name, instead of asking the repository', async () => {
		const { opened } = installRepository();
		await listed();
		const info = vi.spyOn(toast, 'info');
		const error = vi.spyOn(toast, 'error');

		clickMention({ path: 'ote.ts', line: null });

		await vi.waitFor(() =>
			expect(info).toHaveBeenCalledWith(
				'No file named ote.ts in this workstream',
				expect.anything(),
			),
		);
		expect(error).not.toHaveBeenCalled();
		expect(opened).toEqual([]);
	});

	it('reads the workstream files itself when a click comes before they are listed', async () => {
		const { opened } = installRepository();

		clickMention({ path: 'remote.ts', line: null });

		await vi.waitFor(() => expect(opened).toEqual([openCommand('src/git/remote.ts')]));
	});

	it('leaves the name to the repository when the workstream files cannot be read', async () => {
		const { platform, opened } = installRepository();
		platform.define('repositories.workstream-files', async () => {
			throw new Error('worktree is missing');
		});

		clickMention({ path: 'remote.ts', line: 5 });

		await vi.waitFor(() => expect(opened).toEqual([openCommand('remote.ts', 5)]));
	});
});
