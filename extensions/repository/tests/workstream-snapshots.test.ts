import assert from 'node:assert/strict';
import test from 'node:test';
import type {
	ExtensionPanelContext,
	ExtensionPullRequestContext,
	ExtensionPullRequestQuery,
	ExtensionWorkstream,
} from '@malini/extension-api';
import {
	REPOSITORY_WARMUP_PARALLEL_READS,
	REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS,
	REPOSITORY_WARMUP_RETRY_MS,
	REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT,
	RepositoryController,
	repositorySurfaceState,
	type RepositoryControllerHost,
	type RepositoryViewState,
} from '../src/controller.js';
import { createRepositoryPanel, type RepositoryPanelHost } from '../src/panel.js';
import { withDom } from './dom.js';

const alpha = workstream('workstream-a');
const bravo = workstream('workstream-b');

test('returning to a visited workstream shows its tree before any read completes', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();
	await harness.switchTo(bravo);

	harness.holdReads();
	const state = harness.controller.setWorkstream(alpha);

	assert.deepEqual(filePaths(state), ['alpha.ts']);
	assert.notEqual(state.refreshedAt, null);
	assert.equal(state.context?.workstreamId, alpha.id);
});

test('does not restore a snapshot taken on another branch of the workstream', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();
	await harness.switchTo(bravo);

	harness.holdReads();
	const state = harness.controller.setWorkstream({ ...alpha, branch: 'feature/renamed' });

	assert.deepEqual(filePaths(state), []);
	assert.equal(state.refreshedAt, null);
});

test('forgets an archived workstream, so its tree is never shown again from memory', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();
	await harness.switchTo(bravo);

	harness.controller.forgetWorkstream(alpha.id);
	harness.holdReads();

	assert.deepEqual(filePaths(harness.controller.setWorkstream(alpha)), []);
});

test('remembers a bounded number of workstreams', async () => {
	const visited = Array.from({ length: REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT + 1 }, (_, index) =>
		workstream(`workstream-${index}`),
	);
	const [oldest, secondOldest] = visited;
	assert.ok(oldest && secondOldest);
	const harness = createHarness(
		Object.fromEntries(visited.map(({ id }) => [id, [`${id}.ts`]])),
		oldest,
	);
	await harness.controller.refresh();
	for (const next of visited.slice(1)) await harness.switchTo(next);

	harness.holdReads();
	assert.deepEqual(filePaths(harness.controller.setWorkstream(oldest)), []);
	assert.deepEqual(filePaths(harness.controller.setWorkstream(secondOldest)), [
		`${secondOldest.id}.ts`,
	]);
});

test('shows the local snapshot while the pull request is still being read', async () => {
	const pullRequest = deferred<ExtensionPullRequestContext>();
	const harness = createHarness({ [alpha.id]: ['alpha.ts'] }, alpha, () => pullRequest.promise);

	const refreshing = harness.controller.refresh();
	await settle();
	const published = harness.states.find((state) => state.files.length > 0);

	assert.ok(published, 'the tree must be published before the pull request read finishes');
	assert.deepEqual(filePaths(published), ['alpha.ts']);
	assert.equal(published.pullRequestRefreshStatus, 'loading');
	pullRequest.resolve(notOpenPullRequest(alpha));
	assert.equal((await refreshing).pullRequestRefreshStatus, 'ready');
});

test('a first load shows the file list before the status and diffs are read', async () => {
	const statusRead = deferred<void>();
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'] },
		alpha,
		undefined,
		() => statusRead.promise,
	);

	const refreshing = harness.controller.refresh();
	await settle();
	const published = harness.states.find((state) => state.files.length > 0);

	assert.ok(published, 'the file list must be published before the status read finishes');
	assert.deepEqual(filePaths(published), ['alpha.ts']);
	statusRead.resolve();
	assert.equal((await refreshing).status, 'ready');
});

test('switching to a workstream warmed in the background shows its tree and pull request at once', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();
	const warmed: RepositoryViewState[] = [];

	await harness.controller.warmWorkstreams([alpha, bravo], (state) => {
		warmed.push(state);
	});
	harness.holdReads();

	assert.deepEqual(
		warmed.map(({ context }) => context?.workstreamId),
		[bravo.id],
	);
	const opened = harness.controller.setWorkstream(bravo);
	assert.deepEqual(filePaths(opened), ['bravo.ts']);
	assert.equal(opened.context?.pullRequest?.state, 'not_open');
	assert.equal(opened.pullRequestRefreshedAt, warmed[0]?.pullRequestRefreshedAt);
	assert.equal(opened.todoStatus, 'ready');
});

test('a restored snapshot says it is revalidating and keeps the time its pull request was read', async () => {
	let now = 100;
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		undefined,
		undefined,
		() => now,
	);
	await harness.controller.refresh();
	const readAt = harness.controller.snapshot().pullRequestRefreshedAt;
	now = 200;
	await harness.switchTo(bravo);
	now = 300;

	harness.holdReads();
	const restored = harness.controller.setWorkstream(alpha);

	assert.equal(readAt, 100);
	assert.equal(restored.pullRequestRefreshStatus, 'loading');
	assert.equal(restored.status, 'loading');
	assert.equal(restored.pullRequestRefreshedAt, readAt);
	assert.equal(restored.pullRequestSettledAt, readAt);
	assert.deepEqual(filePaths(restored), ['alpha.ts']);
});

test('the pull request read time moves only when a pull request read completes', async () => {
	let now = 100;
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'] },
		alpha,
		undefined,
		undefined,
		() => now,
	);
	await harness.controller.refresh();
	now = 200;

	const localOnly = await harness.controller.refreshLocal();
	now = 300;
	const withPullRequest = await harness.controller.refreshPullRequest();

	assert.equal(localOnly.pullRequestRefreshedAt, 100);
	assert.equal(withPullRequest.pullRequestRefreshedAt, 300);
});

test('the pull request settle time moves on every finished pull request read, failed ones included', async () => {
	let now = 100;
	let failing = false;
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'] },
		alpha,
		(current) =>
			failing
				? Promise.reject(new Error('gh failed'))
				: Promise.resolve(notOpenPullRequest(current)),
		undefined,
		() => now,
	);
	await harness.controller.refresh();
	now = 200;
	failing = true;

	const failed = repositorySurfaceState(await harness.controller.refreshPullRequest());
	now = 300;
	const localOnly = repositorySurfaceState(await harness.controller.refreshLocal());
	now = 400;
	failing = false;
	const succeeded = repositorySurfaceState(await harness.controller.refreshPullRequest());

	assert.equal(failed.pullRequestRefreshStatus, 'error');
	assert.deepEqual(
		[failed, localOnly, succeeded].map((surface) => [
			surface.pullRequestSettledAt,
			surface.pullRequestRefreshedAt,
		]),
		[
			[200, 100],
			[200, 100],
			[400, 400],
		],
	);
});

test('never keeps a pull request answer that belongs to another branch', async () => {
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		(current) =>
			Promise.resolve({
				...notOpenPullRequest(current),
				state: 'open',
				number: 12,
				headBranch: current.id === bravo.id ? 'feature/elsewhere' : current.branch,
			}),
	);
	await harness.controller.refresh();
	const warmed: RepositoryViewState[] = [];

	await harness.controller.warmWorkstreams([bravo], (state) => {
		warmed.push(state);
	});
	harness.holdReads();

	assert.deepEqual(warmed, []);
	const opened = harness.controller.setWorkstream(bravo);
	assert.deepEqual(filePaths(opened), ['bravo.ts']);
	assert.equal(opened.context?.pullRequest, null);
	assert.equal(opened.pullRequestRefreshedAt, null);
});

test('warms every workstream tree before it waits on any pull request read', async () => {
	let finishPullRequestRead!: () => void;
	const pullRequestRead = new Promise<void>((resolve) => {
		finishPullRequestRead = resolve;
	});
	const charlie = workstream('workstream-c');
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'], [charlie.id]: ['charlie.ts'] },
		alpha,
		async (current) => {
			if (current.id !== alpha.id) await pullRequestRead;
			return notOpenPullRequest(current);
		},
	);
	await harness.controller.refresh();

	const warming = harness.controller.warmWorkstreams([bravo, charlie], () => undefined);
	await settle();

	assert.deepEqual(filePaths(harness.controller.workstreamState(bravo)), ['bravo.ts']);
	assert.deepEqual(filePaths(harness.controller.workstreamState(charlie)), ['charlie.ts']);
	finishPullRequestRead();
	await warming;
	assert.equal(harness.controller.workstreamState(charlie).pullRequestRefreshStatus, 'ready');
});

test('reads a workstream once while a warm-up for it is already running', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();

	await Promise.all([
		harness.controller.warmWorkstreams([bravo], () => undefined),
		harness.controller.warmWorkstreams([bravo], () => undefined),
	]);

	assert.deepEqual(harness.pullRequestReads(bravo.id), 1);
});

test('does not read again soon after a workstream could not be warmed', async () => {
	let now = 1_000;
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		(current) =>
			Promise.resolve({
				...notOpenPullRequest(current),
				state: 'open',
				number: 12,
				headBranch: current.id === bravo.id ? 'feature/elsewhere' : current.branch,
			}),
		undefined,
		() => now,
	);
	await harness.controller.refresh();

	await harness.controller.warmWorkstreams([bravo], () => undefined);
	await harness.controller.warmWorkstreams([bravo], () => undefined);
	assert.equal(harness.pullRequestReads(bravo.id), 1);

	now += REPOSITORY_WARMUP_RETRY_MS;
	await harness.controller.warmWorkstreams([bravo], () => undefined);
	assert.equal(harness.pullRequestReads(bravo.id), 2);
});

test('reads at most a few pull requests at once while warming', async () => {
	const others = Array.from({ length: 5 }, (_, index) => workstream(`workstream-${index}`));
	let inFlight = 0;
	let widest = 0;
	const harness = createHarness(
		Object.fromEntries([alpha, ...others].map(({ id }) => [id, [`${id}.ts`]])),
		alpha,
		async (current) => {
			inFlight += 1;
			widest = Math.max(widest, inFlight);
			await settle();
			inFlight -= 1;
			return notOpenPullRequest(current);
		},
	);
	await harness.controller.refresh();
	widest = 0;

	await harness.controller.warmWorkstreams(others, () => undefined);

	assert.equal(widest, REPOSITORY_WARMUP_PARALLEL_READS);
});

test('warm-ups asked for separately share the same few reads at once', async () => {
	const others = Array.from({ length: 5 }, (_, index) => workstream(`workstream-${index}`));
	const reads = { local: 0, pullRequest: 0 };
	const widest = { local: 0, pullRequest: 0 };
	const track = async (kind: keyof typeof reads): Promise<void> => {
		reads[kind] += 1;
		widest[kind] = Math.max(widest[kind], reads[kind]);
		await settle();
		reads[kind] -= 1;
	};
	const harness = createHarness(
		Object.fromEntries([alpha, ...others].map(({ id }) => [id, [`${id}.ts`]])),
		alpha,
		async (current) => {
			await track('pullRequest');
			return notOpenPullRequest(current);
		},
		() => track('local'),
	);
	await harness.controller.refresh();
	widest.local = 0;
	widest.pullRequest = 0;

	await Promise.all(
		others.map((other) => harness.controller.warmWorkstreams([other], () => undefined)),
	);

	assert.deepEqual(widest, {
		local: REPOSITORY_WARMUP_PARALLEL_READS,
		pullRequest: REPOSITORY_WARMUP_PARALLEL_READS,
	});
	assert.deepEqual(
		others.map(({ id }) => harness.pullRequestReads(id)),
		others.map(() => 1),
	);
});

test('forgetting a workstream drops a warm-up that is still reading its tree', async () => {
	let statusGate: Promise<void> | null = null;
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		undefined,
		() => statusGate ?? Promise.resolve(),
	);
	await harness.controller.refresh();
	const localRead = deferred<void>();
	statusGate = localRead.promise;
	const warmed: RepositoryViewState[] = [];

	const warming = harness.controller.warmWorkstreams([bravo], (state) => {
		warmed.push(state);
	});
	await settle();
	harness.controller.forgetWorkstream(bravo.id);
	statusGate = null;
	localRead.resolve();
	await warming;

	assert.deepEqual(warmed, []);
	assert.equal(harness.pullRequestReads(bravo.id), 0);
	harness.holdReads();
	assert.deepEqual(filePaths(harness.controller.setWorkstream(bravo)), []);
});

test('forgetting a workstream drops a warm-up that is still reading its pull request', async () => {
	const pullRequestRead = deferred<void>();
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		async (current) => {
			if (current.id === bravo.id) await pullRequestRead.promise;
			return notOpenPullRequest(current);
		},
	);
	await harness.controller.refresh();
	const warmed: RepositoryViewState[] = [];

	const warming = harness.controller.warmWorkstreams([bravo], (state) => {
		warmed.push(state);
	});
	await settle();
	harness.controller.forgetWorkstream(bravo.id);
	pullRequestRead.resolve();
	await warming;

	assert.deepEqual(warmed, []);
	harness.holdReads();
	assert.deepEqual(filePaths(harness.controller.setWorkstream(bravo)), []);
});

test('never drops the open workstream to make room for warmed ones', async () => {
	const visited = Array.from({ length: REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT - 1 }, (_, index) =>
		workstream(`workstream-${index}`),
	);
	const hovered = workstream('workstream-hovered');
	let pullRequestsAnswer = false;
	const harness = createHarness(
		Object.fromEntries([alpha, hovered, ...visited].map(({ id }) => [id, [`${id}.ts`]])),
		alpha,
		(current) =>
			pullRequestsAnswer
				? Promise.resolve(notOpenPullRequest(current))
				: Promise.reject(new Error('gh offline')),
	);
	for (const next of visited) await harness.switchTo(next);
	await harness.switchTo(alpha);
	pullRequestsAnswer = true;

	await harness.controller.warmWorkstreams(visited, () => undefined);
	await harness.controller.warmWorkstreams([hovered], () => undefined);
	await harness.switchTo(hovered);

	harness.holdReads();
	assert.deepEqual(filePaths(harness.controller.setWorkstream(alpha)), [`${alpha.id}.ts`]);
});

test('makes room by dropping workstreams warmed in the background before ones that were opened', async () => {
	const others = Array.from({ length: REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT - 1 }, (_, index) =>
		workstream(`workstream-${index}`),
	);
	const harness = createHarness(
		Object.fromEntries([alpha, bravo, ...others].map(({ id }) => [id, [`${id}.ts`]])),
		alpha,
	);
	await harness.controller.refresh();
	await harness.switchTo(bravo);

	await harness.controller.warmWorkstreams(others, () => undefined);

	harness.holdReads();
	assert.deepEqual(filePaths(harness.controller.setWorkstream(alpha)), [`${alpha.id}.ts`]);
});

test('a warm-up accepts a recent pull request answer while the open workstream always asks again', async () => {
	const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
	await harness.controller.refresh();

	await harness.controller.warmWorkstreams([bravo], () => undefined);
	await harness.controller.refreshPullRequest();

	assert.deepEqual(harness.pullRequestQueries(bravo.id), [
		{ maxAgeMs: REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS },
	]);
	assert.deepEqual(
		harness.pullRequestQueries(alpha.id).map((query) => query?.maxAgeMs),
		[undefined, undefined],
	);
});

test('a warm-up reads a bound pull request once when it is the latest one on the branch', async () => {
	const harness = boundPullRequestHarness(() => 12);
	await harness.switchTo(bravo);
	await harness.switchTo(alpha);
	harness.controller.forgetWorkstream(bravo.id);
	const before = harness.pullRequestQueries(bravo.id).length;

	await harness.controller.warmWorkstreams([bravo], () => undefined);

	assert.deepEqual(harness.pullRequestQueries(bravo.id).slice(before), [
		{ maxAgeMs: REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS },
	]);
	assert.equal(harness.controller.workstreamState(bravo).context?.pullRequest?.number, 12);
});

test('a warm-up asks for the bound pull request when the latest one on the branch is another', async () => {
	let latest = 12;
	const harness = boundPullRequestHarness(() => latest);
	await harness.switchTo(bravo);
	await harness.switchTo(alpha);
	harness.controller.forgetWorkstream(bravo.id);
	latest = 13;
	const before = harness.pullRequestQueries(bravo.id).length;

	await harness.controller.warmWorkstreams([bravo], () => undefined);

	assert.deepEqual(harness.pullRequestQueries(bravo.id).slice(before), [
		{ maxAgeMs: REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS },
		{ pullRequestNumber: 12, maxAgeMs: REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS },
	]);
	assert.equal(harness.controller.workstreamState(bravo).context?.pullRequest?.number, 12);
});

test('warms no more workstreams than it can remember', async () => {
	const others = Array.from({ length: REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT + 2 }, (_, index) =>
		workstream(`workstream-${index}`),
	);
	const harness = createHarness(Object.fromEntries(others.map(({ id }) => [id, [`${id}.ts`]])));
	await harness.controller.refresh();
	let warmed = 0;

	await harness.controller.warmWorkstreams(others, () => {
		warmed += 1;
	});

	assert.equal(warmed, REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT - 1);
});

test('a new workstream shows the files of the base it starts from before its checkout exists', async () => {
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'] },
		alpha,
		undefined,
		undefined,
		undefined,
		(target) => Promise.resolve(target.baseBranch === 'main' ? ['README.md', 'src/app.ts'] : []),
	);
	await harness.controller.refresh();
	await harness.controller.warmWorkstreams(
		[{ ...alpha, repositoryRootPath: '/tmp/repo' }],
		() => {},
	);
	await settle();
	const newcomer = { ...workstream('workstream-new'), repositoryRootPath: '/tmp/repo' };

	const preview = harness.controller.workstreamState(newcomer);
	harness.holdReads();
	const opened = harness.controller.setWorkstream(newcomer);

	assert.deepEqual(filePaths(preview), ['README.md', 'src/app.ts']);
	assert.deepEqual(filePaths(opened), ['README.md', 'src/app.ts']);
	assert.deepEqual(opened.context?.dirtyPaths, []);
	assert.equal(opened.refreshedAt, null);
	assert.equal(opened.pullRequestRefreshedAt, null);
});

test('never shows the base tree for a workstream that already has a checkout of its own', async () => {
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		undefined,
		undefined,
		undefined,
		() => Promise.resolve(['README.md']),
	);
	const existing = { ...bravo, branch: 'feature/renamed', repositoryRootPath: '/tmp/repo' };
	await harness.controller.warmWorkstreams([existing], () => {});
	await settle();
	harness.holdReads();

	assert.deepEqual(filePaths(harness.controller.workstreamState(existing)), []);
});

test('a view opened on a new workstream shows the base tree as soon as it is read', async () => {
	await withDom(async ({ document }) => {
		let finishBaseRead!: () => void;
		const baseRead = new Promise<void>((resolve) => {
			finishBaseRead = resolve;
		});
		const harness = createHarness(
			{ [alpha.id]: ['alpha.ts'] },
			alpha,
			undefined,
			undefined,
			undefined,
			async () => {
				await baseRead;
				return ['README.md'];
			},
		);
		await harness.controller.refresh();
		const newcomer = { ...workstream('workstream-new'), repositoryRootPath: '/tmp/repo' };
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(harness.panelApi, harness.controller).mount(
			target,
			panelContext(newcomer),
		);
		try {
			assert.deepEqual(treeLabels(target), []);
			finishBaseRead();
			await settle();
			assert.deepEqual(treeLabels(target), ['Open README.md']);
		} finally {
			await instance.dispose();
		}
	});
});

test('the first tree of a workstream is published only once its icons are ready', async () => {
	let finishIcons!: () => void;
	const icons = new Promise<void>((resolve) => {
		finishIcons = resolve;
	});
	const prepared: string[][] = [];
	const harness = createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		undefined,
		undefined,
		undefined,
		undefined,
		async (paths) => {
			prepared.push([...paths]);
			await icons;
		},
	);

	const refreshing = harness.controller.refresh();
	const warming = harness.controller.warmWorkstreams([bravo], () => undefined);
	await settle();

	assert.equal(
		harness.states.some((state) => state.files.length > 0),
		false,
	);
	assert.deepEqual(filePaths(harness.controller.workstreamState(bravo)), []);
	finishIcons();
	await Promise.all([refreshing, warming]);
	assert.deepEqual(filePaths(harness.controller.snapshot()), ['alpha.ts']);
	assert.deepEqual(filePaths(harness.controller.workstreamState(bravo)), ['bravo.ts']);
	assert.deepEqual(new Set(prepared.flat()), new Set(['alpha.ts', 'bravo.ts']));
});

test('a folder opens with its rows and their icons together', async () => {
	await withDom(async ({ document }) => {
		let finishDecode!: () => void;
		const decoded = new Promise<void>((resolve) => {
			finishDecode = resolve;
		});
		const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
		Object.defineProperty(globalThis, 'Image', {
			configurable: true,
			writable: true,
			value: class {
				src = '';
				decode(): Promise<void> {
					return decoded;
				}
			},
		});
		try {
			const harness = createHarness({ [alpha.id]: ['docs/guide.md', 'README.md'] });
			await harness.controller.refresh();
			const target = document.createElement('div');
			const instance = await createRepositoryPanel(harness.panelApi, harness.controller).mount(
				target,
				panelContext(alpha),
			);
			try {
				treeRow(target, 'Expand directory docs').click();
				await settle();
				assert.deepEqual(treeLabels(target), ['Expand directory docs', 'Open README.md']);

				finishDecode();
				await settle();
				assert.deepEqual(treeLabels(target), [
					'Collapse directory docs',
					'Open docs/guide.md',
					'Open README.md',
				]);
			} finally {
				await instance.dispose();
			}
		} finally {
			if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage);
			else Reflect.deleteProperty(globalThis, 'Image');
		}
	});
});

test('a panel bound to one workstream never renders another workstream tree', async () => {
	await withDom(async ({ document }) => {
		const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
		await harness.controller.refresh();
		await harness.switchTo(bravo);
		await harness.switchTo(alpha);

		const target = document.createElement('div');
		const instance = await createRepositoryPanel(harness.panelApi, harness.controller).mount(
			target,
			panelContext(bravo),
		);
		try {
			assert.deepEqual(treeLabels(target), ['Open bravo.ts']);

			harness.setFiles(alpha.id, ['alpha.ts', 'alpha-two.ts']);
			await harness.controller.refresh();

			assert.deepEqual(treeLabels(target), ['Open bravo.ts']);
		} finally {
			await instance.dispose();
		}
	});
});

test('a panel bound to another workstream does not act on the active repository', async () => {
	await withDom(async ({ document }) => {
		const harness = createHarness({ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] });
		await harness.controller.refresh();
		await harness.switchTo(bravo);
		await harness.switchTo(alpha);

		const target = document.createElement('div');
		const instance = await createRepositoryPanel(harness.panelApi, harness.controller).mount(
			target,
			panelContext(bravo),
		);
		try {
			treeRow(target, 'Open bravo.ts').click();
			await settle();

			assert.deepEqual(harness.fileReads, []);
			assert.deepEqual(harness.notifications, []);
			assert.equal(harness.controller.snapshot().selectedPath, null);
		} finally {
			await instance.dispose();
		}
	});
});

type Harness = Readonly<{
	controller: RepositoryController;
	panelApi: RepositoryPanelHost;
	fileReads: readonly string[];
	notifications: readonly string[];
	switchTo(next: ExtensionWorkstream): Promise<void>;
	holdReads(): void;
	setFiles(workstreamId: string, paths: readonly string[]): void;
	states: readonly RepositoryViewState[];
	pullRequestReads(workstreamId: string): number;
	pullRequestQueries(workstreamId: string): readonly (ExtensionPullRequestQuery | null)[];
}>;

function createHarness(
	filesByWorkstream: Readonly<Record<string, readonly string[]>>,
	initial: ExtensionWorkstream = alpha,
	pullRequest: (
		workstream: ExtensionWorkstream,
		query?: ExtensionPullRequestQuery,
	) => Promise<ExtensionPullRequestContext> = (current) =>
		Promise.resolve(notOpenPullRequest(current)),
	statusGate: () => Promise<void> = () => Promise.resolve(),
	clock: () => number = () => 1,
	baseFiles: (workstream: ExtensionWorkstream) => Promise<readonly string[]> = () =>
		Promise.resolve([]),
	prepareTree?: (paths: readonly string[]) => Promise<void>,
): Harness {
	let active = initial;
	let held: Promise<never> | null = null;
	const files = new Map(Object.entries(filesByWorkstream));
	const fileReads: string[] = [];
	const notifications: string[] = [];
	const states: RepositoryViewState[] = [];
	const pullRequestReads: string[] = [];
	const pullRequestQueries: { workstreamId: string; query: ExtensionPullRequestQuery | null }[] =
		[];
	const stored = new Map<string, unknown>();
	const workstreamFor = (workstreamId: string | undefined): ExtensionWorkstream =>
		workstreamId === undefined || workstreamId === active.id ? active : workstream(workstreamId);
	const read = async <T>(value: () => T): Promise<T> => {
		if (held) await held;
		return value();
	};
	const api: RepositoryControllerHost = {
		workstream: {
			current: () => active,
			listFiles: (_glob, workstreamId) => read(() => files.get(workstreamId ?? active.id) ?? []),
			readFile: async (path, workstreamId) => {
				fileReads.push(`${workstreamId ?? active.id}:${path}`);
				return '';
			},
		},
		repository: {
			status: async (workstreamId) => {
				await statusGate();
				const target = workstreamFor(workstreamId);
				return read(() => ({
					branch: target.branch,
					baseBranch: target.baseBranch,
					dirtyPaths: [],
					ahead: 0,
					behind: 0,
				}));
			},
			diff: () => read(() => []),
			pullRequest: (workstreamId, query) => {
				const target = workstreamFor(workstreamId);
				pullRequestReads.push(target.id);
				pullRequestQueries.push({ workstreamId: target.id, query: query ?? null });
				return pullRequest(target, query);
			},
			createPullRequest: () => Promise.reject(new Error('not used')),
			refresh: () => read(() => undefined),
			commit: () => Promise.reject(new Error('not used')),
			push: () => Promise.reject(new Error('not used')),
			pullLatest: () => Promise.reject(new Error('not used')),
			baseFiles,
		},
		settings: { get: () => false },
		clock: { now: clock },
		state: {
			get: async (key, scope) => stored.get(JSON.stringify([key, scope ?? null])) ?? null,
			set: async (key, value, scope) => {
				stored.set(JSON.stringify([key, scope ?? null]), value);
			},
			delete: async (key, scope) => {
				stored.delete(JSON.stringify([key, scope ?? null]));
			},
		},
	};
	const controller = new RepositoryController(api, prepareTree ? { prepareTree } : {});
	controller.subscribe((state) => states.push(state));
	return {
		controller,
		states,
		pullRequestReads: (workstreamId) =>
			pullRequestReads.filter((readWorkstreamId) => readWorkstreamId === workstreamId).length,
		pullRequestQueries: (workstreamId) =>
			pullRequestQueries
				.filter((read) => read.workstreamId === workstreamId)
				.map(({ query }) => query),
		fileReads,
		notifications,
		panelApi: {
			manifest: { id: 'malini.repository' },
			notifications: {
				show: async ({ body }) => {
					notifications.push(body ?? '');
				},
			},
			workstream: { readFile: api.workstream.readFile },
			panels: {
				register: () => ({ dispose: () => undefined }),
				open: () => undefined,
			},
		},
		async switchTo(next) {
			active = next;
			controller.setWorkstream(next);
			await controller.refresh();
		},
		holdReads() {
			held = new Promise<never>(() => undefined);
		},
		setFiles(workstreamId, paths) {
			files.set(workstreamId, paths);
		},
	};
}

function boundPullRequestHarness(latest: () => number): Harness {
	return createHarness(
		{ [alpha.id]: ['alpha.ts'], [bravo.id]: ['bravo.ts'] },
		alpha,
		(current, query) => {
			if (current.id !== bravo.id) return Promise.resolve(notOpenPullRequest(current));
			const number = query?.pullRequestNumber ?? latest();
			return Promise.resolve({
				...notOpenPullRequest(current),
				state: 'open',
				number,
				title: `#${number}`,
				url: `https://example.test/pull/${number}`,
			});
		},
	);
}

function workstream(id: string): ExtensionWorkstream {
	return {
		id,
		path: `/tmp/${id}`,
		repositoryPath: `/tmp/${id}`,
		branch: `feature/${id}`,
		baseBranch: 'main',
	};
}

function notOpenPullRequest(current: ExtensionWorkstream): ExtensionPullRequestContext {
	return {
		state: 'not_open',
		number: null,
		title: null,
		url: null,
		baseBranch: current.baseBranch,
		headBranch: current.branch,
		checks: 'unknown',
	};
}

function panelContext(current: ExtensionWorkstream): ExtensionPanelContext {
	return {
		workstream: current,
		settings: {},
		executeCommand: () => Promise.reject(new Error('not used')),
	};
}

function filePaths(state: RepositoryViewState): string[] {
	return state.files.map(({ path }) => path);
}

function treeLabels(target: HTMLElement): string[] {
	return [...target.querySelectorAll('[role="treeitem"]')].map(
		(row) => row.getAttribute('aria-label') ?? '',
	);
}

function treeRow(target: HTMLElement, label: string): HTMLElement {
	const row = [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
		(candidate) => candidate.getAttribute('aria-label') === label,
	);
	assert.ok(row, `tree row ${label} must be rendered`);
	return row;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 5; turn += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
