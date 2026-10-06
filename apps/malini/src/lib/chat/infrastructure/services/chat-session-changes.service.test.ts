import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import type {
	AgentSessionChangedFile,
	AgentSessionChanges,
} from '$shared/repositories/repositories.api';
import { chatSessionChanges } from './chat-session-changes.service';

const FILE: AgentSessionChangedFile = {
	path: 'src/app.ts',
	additions: 1,
	deletions: 0,
	isBinary: false,
	runIds: ['run-1'],
};

const CHANGES: AgentSessionChanges = {
	sessionId: 'session-1',
	runs: [
		{
			runId: 'run-1',
			beforeCommit: 'before-1',
			afterCommit: 'after-1',
			files: [{ path: 'src/app.ts', additions: 1, deletions: 0, isBinary: false }],
			capturedAt: '2026-01-01T00:00:00.000Z',
		},
	],
	files: [FILE],
	beforeCommit: 'before-1',
	afterCommit: 'after-1',
	capturedAt: '2026-01-01T00:00:00.000Z',
};

function installPlatform(): FakePlatform {
	const platform = createFakePlatform();
	platform.define('chat.session-changes', async () => ({
		...CHANGES,
		runs: CHANGES.runs.map((run) => ({ ...run, files: [...run.files] })),
		files: CHANGES.files.map((file) => ({ ...file, runIds: [...file.runIds] })),
	}));
	platform.define('chat.session-change-patch', async () => ({
		sessionId: 'session-1',
		beforeCommit: 'before-1',
		afterCommit: 'after-1',
		patch: '',
		turns: [],
	}));
	setPlatformForTest(platform);
	return platform;
}

afterEach(() => {
	chatSessionChanges.cancel();
	setPlatformForTest(null);
});

describe('reading a chat’s changed files', () => {
	it('asks for session changes inside the caller’s workstream', async () => {
		const platform = installPlatform();

		await expect(
			chatSessionChanges.load({ workstreamId: 'workstream-1', sessionId: 'session-1' }),
		).resolves.toMatchObject({ sessionId: 'session-1' });

		expect(platform.calls).toEqual([
			{
				command: 'chat.session-changes',
				args: {
					workstreamId: 'workstream-1',
					sessionId: 'session-1',
				},
			},
		]);
	});

	it('asks for a changed file’s patch inside the same workstream', async () => {
		const platform = installPlatform();

		await expect(
			chatSessionChanges.openChangedFile({
				workstreamId: 'workstream-1',
				changes: CHANGES,
				file: FILE,
			}),
		).rejects.toThrow('The repository extension is not active for this workstream');

		expect(platform.calls).toEqual([
			{
				command: 'chat.session-change-patch',
				args: {
					workstreamId: 'workstream-1',
					sessionId: 'session-1',
					path: 'src/app.ts',
				},
			},
		]);
	});
});
