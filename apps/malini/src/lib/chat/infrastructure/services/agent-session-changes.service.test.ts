import { describe, expect, it, vi } from 'vitest';
import type {
	AgentSessionChangePatch,
	AgentSessionChanges,
} from '$shared/repositories/repositories.api';
import {
	buildAgentSessionFileDiffRequest,
	LatestAgentSessionChangesQuery,
	OpenAgentSessionChangedFileCommand,
} from './agent-session-changes.service';

function withResolvers<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const sessionChanges: AgentSessionChanges = {
	sessionId: 'session-1',
	runs: [
		{
			runId: 'run-1',
			beforeCommit: 'before-1',
			afterCommit: 'after-1',
			capturedAt: '2026-07-22T08:00:00Z',
			files: [
				{ path: 'src/app.ts', additions: 1, deletions: 0, isBinary: false },
				{ path: 'README.md', additions: 1, deletions: 0, isBinary: false },
			],
		},
		{
			runId: 'run-2',
			beforeCommit: 'before-2',
			afterCommit: 'after-2',
			capturedAt: '2026-07-22T08:05:00Z',
			files: [{ path: 'src/app.ts', additions: 2, deletions: 1, isBinary: false }],
		},
	],
	files: [
		{
			path: 'src/app.ts',
			additions: 3,
			deletions: 1,
			isBinary: false,
			runIds: ['run-1', 'run-2'],
		},
		{
			path: 'README.md',
			additions: 1,
			deletions: 0,
			isBinary: false,
			runIds: ['run-1'],
		},
	],
	beforeCommit: 'before-1',
	afterCommit: 'after-2',
	capturedAt: '2026-07-22T08:05:00Z',
};

const scope = { workstreamId: 'workstream-1' } as const;

const runOnePatch = [
	'diff --git a/src/app.ts b/src/app.ts',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -1 +1,2 @@',
	' export const app = true;',
	'+export const chat = true;',
].join('\n');

const runTwoPatch = [
	'diff --git a/src/app.ts b/src/app.ts',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -1,2 +1,3 @@',
	'-export const chat = true;',
	'+export const chat = "active";',
	'+export const exact = true;',
	' export const app = true;',
].join('\n');

describe('LatestAgentSessionChangesQuery', () => {
	it('discards a response that arrives after a newer chat query', async () => {
		let resolveFirst!: (changes: AgentSessionChanges) => void;
		const first = new Promise<AgentSessionChanges>((resolve) => {
			resolveFirst = resolve;
		});
		const second = { ...sessionChanges, sessionId: 'session-2' };
		const port = {
			getSessionChanges: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(second),
		};
		const query = new LatestAgentSessionChangesQuery(port);

		const stale = query.execute({ ...scope, sessionId: 'session-1' });
		await expect(query.execute({ ...scope, sessionId: 'session-2' })).resolves.toEqual(second);
		resolveFirst(sessionChanges);
		await expect(stale).resolves.toBeNull();
		expect(port.getSessionChanges).toHaveBeenNthCalledWith(2, {
			...scope,
			sessionId: 'session-2',
		});
	});
});

describe('agent session file diff command', () => {
	it('keeps run attribution but requests one net patch for only the selected path', async () => {
		const getSessionChangePatch = vi.fn(
			async ({ sessionId, path }: { sessionId: string; path: string }) => {
				expect(path).toBe('src/app.ts');
				return {
					sessionId,
					beforeCommit: 'before-1',
					afterCommit: 'after-2',
					patch: runTwoPatch,
					turns: [],
				};
			},
		);

		const request = await buildAgentSessionFileDiffRequest(
			{ getSessionChangePatch },
			scope,
			sessionChanges,
			sessionChanges.files[0]!,
		);

		expect(request.path).toBe('src/app.ts');
		expect(request.contributingRunIds).toEqual(['run-1', 'run-2']);
		expect(request.net.patch).toContain('diff --git a/src/app.ts b/src/app.ts');
		expect(request.net.patch).not.toContain('README.md');
		expect([request.additions, request.deletions]).toEqual([3, 1]);
		expect(getSessionChangePatch).toHaveBeenCalledOnce();
		expect(getSessionChangePatch).toHaveBeenCalledWith({
			...scope,
			sessionId: 'session-1',
			path: 'src/app.ts',
		});
	});

	it('forwards a turn-by-turn diff only for runs that changed the file', async () => {
		const turn = (runId: string, number: number, patch: string) => ({
			runId,
			turn: number,
			title: `Turn title ${number}`,
			beforeCommit: `before-${number}`,
			afterCommit: `after-${number}`,
			additions: 1,
			deletions: 0,
			isBinary: false,
			patch,
		});
		const response = (turns: ReturnType<typeof turn>[]) => ({
			getSessionChangePatch: vi.fn(async () => ({
				sessionId: 'session-1',
				beforeCommit: 'before-1',
				afterCommit: 'after-2',
				patch: '',
				turns,
			})),
		});

		const request = await buildAgentSessionFileDiffRequest(
			response([turn('run-1', 1, runOnePatch), turn('run-2', 2, runTwoPatch)]),
			scope,
			sessionChanges,
			sessionChanges.files[0]!,
		);
		expect(request.turns.map(({ runId, turn: number }) => [runId, number])).toEqual([
			['run-1', 1],
			['run-2', 2],
		]);

		await expect(
			buildAgentSessionFileDiffRequest(
				response([turn('run-2', 2, runTwoPatch)]),
				scope,
				sessionChanges,
				sessionChanges.files[1]!,
			),
		).rejects.toThrow('Agent chat turn run-2 does not attribute README.md');
	});

	it('opens Files only after its exact persisted diff is ready', async () => {
		const order: string[] = [];
		const target = {
			open: vi.fn(async () => {
				order.push('open-files');
			}),
		};
		const command = new OpenAgentSessionChangedFileCommand(
			{
				getSessionChangePatch: vi.fn(async ({ sessionId }) => {
					order.push(`patch:${sessionId}`);
					return {
						sessionId,
						beforeCommit: 'before-1',
						afterCommit: 'after-2',
						patch: runTwoPatch,
						turns: [],
					};
				}),
			},
			target,
		);

		await command.execute({
			scope,
			changes: sessionChanges,
			file: sessionChanges.files[0]!,
		});

		expect(order.at(-1)).toBe('open-files');
		expect(target.open).toHaveBeenCalledWith(
			'workstream-1',
			expect.objectContaining({ sessionId: 'session-1', path: 'src/app.ts' }),
			expect.any(AbortSignal),
		);
	});

	it('does not open a late file response after the active chat changes', async () => {
		let resolvePatch!: (patch: AgentSessionChangePatch) => void;
		const pendingPatch = new Promise<AgentSessionChangePatch>((resolve) => {
			resolvePatch = resolve;
		});
		const target = { open: vi.fn(async () => undefined) };
		const command = new OpenAgentSessionChangedFileCommand(
			{ getSessionChangePatch: vi.fn(() => pendingPatch) },
			target,
		);

		const opening = command.execute({
			scope,
			changes: sessionChanges,
			file: sessionChanges.files[1]!,
		});
		command.cancel();
		resolvePatch({
			sessionId: 'session-1',
			beforeCommit: 'before-1',
			afterCommit: 'after-2',
			patch: runOnePatch,
			turns: [],
		});

		await expect(opening).resolves.toBe(false);
		expect(target.open).not.toHaveBeenCalled();
	});

	it('rejects excessive run fan-out before requesting any patches', async () => {
		const runs = Array.from({ length: 65 }, (_, index) => ({
			runId: `run-${index}`,
			beforeCommit: `before-${index}`,
			afterCommit: `after-${index}`,
			capturedAt: '2026-07-22T08:00:00Z',
			files: [{ path: 'src/large.ts', additions: 1, deletions: 0, isBinary: false }],
		}));
		const changes: AgentSessionChanges = {
			sessionId: 'session-many-runs',
			runs,
			files: [
				{
					path: 'src/large.ts',
					additions: 65,
					deletions: 0,
					isBinary: false,
					runIds: runs.map(({ runId }) => runId),
				},
			],
			beforeCommit: 'before-0',
			afterCommit: 'after-64',
			capturedAt: '2026-07-22T08:00:00Z',
		};
		const getSessionChangePatch = vi.fn();

		await expect(
			buildAgentSessionFileDiffRequest(
				{ getSessionChangePatch },
				scope,
				changes,
				changes.files[0]!,
			),
		).rejects.toThrow('at most 64 are supported');
		expect(getSessionChangePatch).not.toHaveBeenCalled();
	});

	it('rejects a patch above the native 2 MiB boundary before opening Files', async () => {
		const target = { open: vi.fn(async () => undefined) };
		const command = new OpenAgentSessionChangedFileCommand(
			{
				getSessionChangePatch: vi.fn(async () => ({
					sessionId: 'session-1',
					beforeCommit: 'before-1',
					afterCommit: 'after-2',
					patch: 'x'.repeat(2 * 1024 * 1024 + 1),
					turns: [],
				})),
			},
			target,
		);

		await expect(
			command.execute({
				scope,
				changes: sessionChanges,
				file: sessionChanges.files[1]!,
			}),
		).rejects.toThrow('exceeds the 2097152-byte limit');
		expect(target.open).not.toHaveBeenCalled();
	});

	it('aborts a target already opening when the active chat changes', async () => {
		let releaseTarget!: () => void;
		const targetState: { signal: AbortSignal | null } = { signal: null };
		const targetStarted = withResolvers<void>();
		const targetReleased = new Promise<void>((resolve) => {
			releaseTarget = resolve;
		});
		const target = {
			open: vi.fn(async (_workstreamId: string, _request: unknown, signal: AbortSignal) => {
				targetState.signal = signal;
				targetStarted.resolve();
				await targetReleased;
			}),
		};
		const command = new OpenAgentSessionChangedFileCommand(
			{
				getSessionChangePatch: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
					sessionId,
					beforeCommit: 'before-1',
					afterCommit: 'after-2',
					patch: runOnePatch,
					turns: [],
				})),
			},
			target,
		);

		const opening = command.execute({
			scope,
			changes: sessionChanges,
			file: sessionChanges.files[1]!,
		});
		await targetStarted.promise;
		command.cancel();
		releaseTarget();

		await expect(opening).resolves.toBe(false);
		expect(targetState.signal?.aborted).toBe(true);
	});
});
