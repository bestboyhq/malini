import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ExtensionPanelContext, ExtensionPanelInstance } from '@malini/extension-api';
import { repositorySurfaceState, type RepositoryViewState } from '../src/controller.js';
import { renderRepositoryDiff } from '../src/domain.js';
import {
	buildRepositoryFileTree,
	changeSummary,
	createRepositoryPanel,
	fileIcon,
	flattenRepositoryTree,
	folderIcon,
	repositoryChangeFileRows,
	repositoryTreeKeyCommand,
	type RepositoryPanelHost,
} from '../src/panel.js';
import { withDom } from './dom.js';

const repositoryContext = {
	workstreamId: 'workstream-1',
	repositoryPath: '/tmp/repository',
	branch: 'feature/review',
	baseBranch: 'main',
	dirtyPaths: [] as string[],
	conflictedPaths: [] as string[],
	conflictMarkerPaths: [] as string[],
	ahead: 0,
	behind: 0,
	hasUpstream: true,
	mergeInProgress: false,
	operationInProgress: null,
	pullRequest: null,
};

test('builds the compact pre-extension file tree with directories first and stable counts', () => {
	const tree = buildRepositoryFileTree([
		'README.md',
		'package.json',
		'src/app.ts',
		'src/lib/panel.ts',
	]);
	assert.deepEqual(
		tree.map(({ name, type, fileCount }) => ({ name, type, fileCount })),
		[
			{ name: 'src', type: 'directory', fileCount: 2 },
			{ name: 'package.json', type: 'file', fileCount: 1 },
			{ name: 'README.md', type: 'file', fileCount: 1 },
		],
	);
	assert.deepEqual(
		flattenRepositoryTree(tree, new Set(['src'])).map(({ node, depth }) => [node.path, depth]),
		[
			['src', 0],
			['src/lib', 1],
			['src/app.ts', 1],
			['package.json', 0],
			['README.md', 0],
		],
	);
});

test('resolves file icons through the vendored Material Icon Theme', async () => {
	await withDom(async () => {
		const iconOf = (path: string): string | undefined => fileIcon(path).dataset.fileIcon;
		assert.equal(iconOf('README.md'), 'readme');
		assert.equal(iconOf('package.json'), 'nodejs');
		assert.equal(iconOf('Panel.svelte'), 'svelte');
		assert.equal(iconOf('schema.sql'), 'database');
		assert.equal(iconOf('main.rs'), 'rust');
		assert.equal(iconOf('index.ts'), 'typescript');
		assert.equal(iconOf('app.routing.ts'), 'routing');
		assert.equal(iconOf('apps/desktop/src/lib/main.rs'), 'rust');
		assert.equal(iconOf('unheard-of.qqq'), 'file');
	});
});

test('gives directories the theme icon for their name and honours disclosure', async () => {
	await withDom(async () => {
		const iconOf = (path: string, expanded = false): string | undefined =>
			folderIcon(path, expanded).dataset.fileIcon;
		assert.equal(iconOf('src'), 'folder-src');
		assert.equal(iconOf('tests'), 'folder-test');
		assert.equal(iconOf('apps/desktop/node_modules'), 'folder-node');
		assert.equal(iconOf('whatever'), 'folder');
		assert.equal(iconOf('src', true), 'folder-src-open');
		assert.equal(iconOf('whatever', true), 'folder-open');
	});
});

test('renders icons as host-served assets rather than inlined markup', async () => {
	await withDom(async () => {
		const icon = fileIcon('main.rs');
		assert.equal(icon.tagName, 'IMG');
		assert.match(icon.getAttribute('src') ?? '', /\/file-icons\/rust\.svg$/u);
		assert.equal(icon.className, 'repository-panel__file-icon');
		assert.equal(folderIcon('src', false).className, 'repository-panel__folder');
		assert.equal(icon.getAttribute('alt'), '');
		assert.equal(icon.getAttribute('aria-hidden'), 'true');
		assert.equal(icon.getAttribute('width'), '14');
		assert.equal(icon.getAttribute('height'), '14');
		assert.equal(icon.dataset.tone, undefined);
	});
});

test('describes change counts in readable singular and empty states', () => {
	assert.equal(changeSummary({ changedFiles: 0, additions: 0, deletions: 0 }), 'No changed files');
	assert.equal(
		changeSummary({ changedFiles: 1, additions: 3, deletions: 1 }),
		'1 changed file · +3 −1',
	);
	assert.equal(
		changeSummary({ changedFiles: 2, additions: 4, deletions: 2 }),
		'2 changed files · +4 −2',
	);
});

test('orders uncommitted files before every unchanged repository file', () => {
	const rows = repositoryChangeFileRows({
		context: {
			...repositoryContext,
			dirtyPaths: ['assets/binary.png', 'src/changed.ts'],
		},
		files: [
			{ path: 'assets/binary.png', name: 'binary.png', directory: 'assets', extension: 'png' },
			{ path: 'README.md', name: 'README.md', directory: '', extension: 'md' },
			{ path: 'src/changed.ts', name: 'changed.ts', directory: 'src', extension: 'ts' },
			{ path: 'src/stable.ts', name: 'stable.ts', directory: 'src', extension: 'ts' },
		],
		diffs: [
			{
				path: 'src/changed.ts',
				lines: [],
				additions: 4,
				deletions: 1,
				noLineChange: null,
			},
		],
	});

	assert.deepEqual(rows, [
		{
			path: 'assets/binary.png',
			changed: true,
			diffAvailable: false,
			additions: 0,
			deletions: 0,
			noLineChange: null,
		},
		{
			path: 'src/changed.ts',
			changed: true,
			diffAvailable: true,
			additions: 4,
			deletions: 1,
			noLineChange: null,
		},
		{
			path: 'README.md',
			changed: false,
			diffAvailable: false,
			additions: 0,
			deletions: 0,
			noLineChange: null,
		},
		{
			path: 'src/stable.ts',
			changed: false,
			diffAvailable: false,
			additions: 0,
			deletions: 0,
			noLineChange: null,
		},
	]);
});

test('mounts every changed file and every visible tree row, with no cap and no show-more', async () => {
	await withDom(async ({ document }) => {
		const paths = Array.from(
			{ length: 2_000 },
			(_, index) => `file-${String(index).padStart(4, '0')}.ts`,
		);
		const state = repositoryPanelState(paths, paths.slice(0, 100));
		const controller = new PanelTestController(state);
		const changesTarget = document.createElement('div');
		const filesTarget = document.createElement('div');
		const api = repositoryPanelApi();
		const changesInstance = await createRepositoryPanel(api, controller, 'changes').mount(
			changesTarget,
			repositoryPanelContext(),
		);
		const filesInstance = await createRepositoryPanel(api, controller, 'files').mount(
			filesTarget,
			repositoryPanelContext(),
		);

		try {
			const changed = changesTarget.querySelector<HTMLUListElement>(
				'ul[aria-label="Changed files"]',
			);
			const tree = filesTarget.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(changed);
			assert.ok(tree);
			assert.equal(changed.dataset.renderedRows, '100');
			assert.equal(changed.dataset.totalRows, '100');
			assert.equal(changed.children.length, 100);
			assert.equal(tree.dataset.renderedRows, '2000');
			assert.equal(tree.dataset.totalRows, '2000');
			assert.equal(tree.children.length, 2_000);
			for (const target of [changesTarget, filesTarget]) {
				assert.equal(target.querySelector('[data-show-more]'), null);
				assert.equal(target.querySelector('.repository-panel__show-more'), null);
			}
		} finally {
			await filesInstance.dispose();
			await changesInstance.dispose();
		}
	});
});

test('the Files tree is the whole worktree, including the files this branch changed', async () => {
	await withDom(async ({ document }) => {
		const state = repositoryPanelState(
			[
				'PARITY-CHECK.md',
				'README.md',
				'package.json',
				'pnpm-lock.yaml',
				'pnpm-workspace.yaml',
				'src/index.ts',
			],
			[],
		);
		const controller = new PanelTestController({
			...state,
			diffs: [
				{ path: 'PARITY-CHECK.md', lines: [], additions: 1, deletions: 0, noLineChange: null },
				{ path: 'README.md', lines: [], additions: 4, deletions: 2, noLineChange: null },
			],
			changedFiles: 2,
			additions: 5,
			deletions: 2,
		});
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller, 'files').mount(
			target,
			repositoryPanelContext(),
		);

		try {
			assert.deepEqual(treeRowPaths(target), [
				'src',
				'package.json',
				'PARITY-CHECK.md',
				'pnpm-lock.yaml',
				'pnpm-workspace.yaml',
				'README.md',
			]);
			assert.equal(treeCount(target), '6');
			assert.ok(target.querySelector('section[aria-label="Files (6)"]'));
		} finally {
			await instance.dispose();
		}
	});
});

test('a changed row shows its line stat, and the directories above it sum theirs', async () => {
	await withDom(async ({ document }) => {
		const state = repositoryPanelState(
			['src/lib/view.ts', 'src/main.ts', 'assets/logo.png', 'README.md'],
			['src/lib/view.ts', 'src/main.ts', 'assets/logo.png'],
		);
		const controller = new PanelTestController({
			...state,
			uncommitted: {
				diffs: [
					{ path: 'src/lib/view.ts', lines: [], additions: 1200, deletions: 3, noLineChange: null },
					{ path: 'src/main.ts', lines: [], additions: 0, deletions: 2, noLineChange: null },
				],
				changedFiles: 3,
				additions: 1200,
				deletions: 5,
			},
		});
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller, 'files').mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const row = (path: string): HTMLElement => {
				const found = target.querySelector<HTMLElement>(
					`.repository-panel__tree [data-path="${path}"]`,
				);
				assert.ok(found, `row ${path}`);
				return found;
			};
			const stat = (path: string): string | null =>
				row(path)
					.querySelector('.repository-panel__tree-stat')
					?.textContent?.replace(/(?<=\S)(?=[+−])/g, ' ') ?? null;
			const marker = (path: string): string | null =>
				row(path).querySelector('.repository-panel__tree-marker')?.textContent ?? null;
			const badge = (path: string): string | null =>
				row(path).querySelector('.repository-panel__tree-badge')?.textContent ?? null;

			assert.equal(stat('src'), '+1.2k −5');
			assert.equal(badge('src'), null);
			assert.equal(stat('assets'), null);
			assert.equal(badge('assets'), '1');

			row('src').click();
			row('src/lib').click();
			assert.equal(stat('src/lib'), '+1.2k −3');
			assert.equal(stat('src/lib/view.ts'), '+1.2k −3');
			assert.equal(marker('src/lib/view.ts'), null);
			assert.equal(stat('src/main.ts'), '−2');
			row('assets').click();
			assert.equal(stat('assets/logo.png'), null);
			assert.equal(marker('assets/logo.png'), 'M');
			assert.equal(stat('README.md'), null);
		} finally {
			await instance.dispose();
		}
	});
});

test('walks a nested file tree by keyboard alone and keeps one roving tab stop', async () => {
	await withDom(async ({ document }) => {
		const state = repositoryPanelState(
			['src/lib/panel/view.ts', 'src/lib/panel/state.ts', 'README.md'],
			[],
		);
		const controller = new PanelTestController(state);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const tree = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(tree);
			const rows = (): readonly HTMLElement[] => treeRowElements(tree);
			const active = (): string | undefined =>
				rows().find((row) => row.dataset.treeActive === 'true')?.dataset.path;
			const tabStops = (): number => rows().filter((row) => row.tabIndex === 0).length;

			assert.deepEqual(
				rows().map((row) => row.dataset.path),
				['src', 'README.md'],
			);
			assert.equal(active(), 'src');
			assert.equal(tabStops(), 1);

			press(document, tree, 'ArrowRight');
			assert.deepEqual(
				rows().map((row) => row.dataset.path),
				['src', 'src/lib', 'README.md'],
			);
			press(document, tree, 'ArrowRight');
			assert.equal(active(), 'src/lib');
			press(document, tree, 'ArrowRight');
			press(document, tree, 'ArrowRight');
			press(document, tree, 'ArrowRight');
			press(document, tree, 'ArrowDown');
			assert.equal(active(), 'src/lib/panel/state.ts');
			assert.equal(tabStops(), 1);
			assert.equal(
				rows().find((row) => row.dataset.path === 'src')?.tabIndex,
				-1,
				'only the active row is reachable with Tab',
			);

			press(document, tree, 'Enter');
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(controller.selectedPaths.at(-1), 'src/lib/panel/state.ts');

			const reopened = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(reopened);
			press(document, reopened, 'ArrowLeft');
			assert.equal(
				treeRowElements(reopened)
					.find((row) => row.dataset.treeActive === 'true')
					?.getAttribute('data-path'),
				'src/lib/panel',
			);
			press(document, reopened, 'ArrowLeft');
			assert.equal(
				reopened.querySelector('[data-path="src/lib/panel"]')?.getAttribute('aria-expanded'),
				'false',
			);
		} finally {
			await instance.dispose();
		}
	});
});

test('counts modified files per directory, recursively up to the root', () => {
	const tree = buildRepositoryFileTree(
		[
			'src/lib/panel/view.ts',
			'src/lib/panel/state.ts',
			'src/lib/index.ts',
			'src/main.ts',
			'README.md',
		],
		new Set(['src/lib/panel/view.ts', 'src/lib/panel/state.ts', 'deleted/gone.ts']),
	);
	const counts = new Map<string, number>();
	const visit = (nodes: readonly (typeof tree)[number][]): void => {
		for (const node of nodes) {
			counts.set(node.path, node.modifiedCount);
			visit(node.children);
		}
	};
	visit(tree);
	assert.deepEqual(
		[...counts.entries()],
		[
			['src', 2],
			['src/lib', 2],
			['src/lib/panel', 2],
			['src/lib/panel/state.ts', 1],
			['src/lib/panel/view.ts', 1],
			['src/lib/index.ts', 0],
			['src/main.ts', 0],
			['README.md', 0],
		],
	);
});

test('badges directories with their recursive modified count and marks modified files', async () => {
	await withDom(async ({ document }) => {
		const paths = [
			'src/lib/panel/view.ts',
			'src/lib/panel/state.ts',
			'src/lib/index.ts',
			'src/main.ts',
			'docs/guide.md',
			'README.md',
		];
		const state = {
			...repositoryPanelState(paths, ['src/lib/panel/view.ts', 'src/lib/panel/state.ts']),
			diffScope: 'branch' as const,
		};
		const controller = new PanelTestController(state);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const tree = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(tree);
			const row = (path: string): HTMLElement => {
				const found = tree.querySelector<HTMLElement>(`[data-path="${path}"]`);
				assert.ok(found, `row ${path}`);
				return found;
			};
			const badge = (path: string): string | null =>
				row(path).querySelector('.repository-panel__tree-badge')?.textContent ?? null;
			const fileCount = (path: string): string | null =>
				row(path).querySelector('.repository-panel__tree-count')?.textContent ?? null;
			const marker = (path: string): string | null =>
				row(path).querySelector('.repository-panel__tree-marker')?.textContent ?? null;

			assert.equal(badge('src'), '2');
			assert.equal(fileCount('src'), null);
			assert.equal(row('src').dataset.modified, 'true');
			assert.equal(row('src').getAttribute('aria-label'), 'Expand directory src, 2 modified files');
			assert.equal(badge('docs'), null);
			assert.equal(fileCount('docs'), '1');
			assert.equal(row('docs').dataset.modified, 'false');
			assert.equal(row('docs').getAttribute('aria-label'), 'Expand directory docs');
			assert.equal(marker('README.md'), null);
			assert.equal(row('README.md').dataset.modified, 'false');
			assert.equal(row('README.md').getAttribute('aria-label'), 'Open README.md');

			row('src').click();
			row('src/lib').click();
			row('src/lib/panel').click();
			assert.equal(badge('src'), '2');
			assert.equal(fileCount('src'), null);
			assert.equal(
				row('src').getAttribute('aria-label'),
				'Collapse directory src, 2 modified files',
			);
			assert.equal(badge('src/lib'), '2');
			assert.equal(badge('src/lib/panel'), '2');
			assert.equal(marker('src/lib/panel/view.ts'), 'M');
			assert.equal(marker('src/lib/panel/state.ts'), 'M');
			assert.equal(row('src/lib/panel/view.ts').dataset.modified, 'true');
			assert.equal(
				row('src/lib/panel/view.ts').getAttribute('aria-label'),
				'Open src/lib/panel/view.ts, modified',
			);
			assert.equal(marker('src/lib/index.ts'), null);
			assert.equal(marker('src/main.ts'), null);
			assert.equal(row('src/main.ts').dataset.modified, 'false');

			const srcRow = row('src');
			const viewRow = row('src/lib/panel/view.ts');
			const modifiedPaths = ['src/lib/panel/view.ts', 'src/main.ts'];
			controller.emit({
				...state,
				context: { ...state.context!, dirtyPaths: modifiedPaths },
				changedFiles: 2,
				uncommitted: { diffs: [], changedFiles: 2, additions: 0, deletions: 0 },
			});
			assert.equal(target.querySelector('.repository-panel__tree'), tree);
			assert.equal(row('src'), srcRow);
			assert.equal(row('src/lib/panel/view.ts'), viewRow);
			assert.equal(badge('src'), '2');
			assert.equal(badge('src/lib'), '1');
			assert.equal(badge('src/lib/panel'), '1');
			assert.equal(marker('src/lib/panel/view.ts'), 'M');
			assert.equal(marker('src/lib/panel/state.ts'), null);
			assert.equal(row('src/lib/panel/state.ts').dataset.modified, 'false');
			assert.equal(
				row('src/lib/panel/state.ts').getAttribute('aria-label'),
				'Open src/lib/panel/state.ts',
			);
			assert.equal(marker('src/main.ts'), 'M');

			controller.emit({
				...state,
				context: { ...state.context!, dirtyPaths: [] },
				changedFiles: 0,
				uncommitted: { diffs: [], changedFiles: 0, additions: 0, deletions: 0 },
			});
			row('src/lib').click();
			assert.equal(badge('src'), null);
			assert.equal(row('src').dataset.modified, 'false');
			assert.equal(badge('src/lib'), null);
			assert.equal(fileCount('src/lib'), '3');
			assert.equal(marker('src/main.ts'), null);
			assert.equal(row('src').getAttribute('aria-label'), 'Collapse directory src');
		} finally {
			await instance.dispose();
		}
	});
});

test('resolves every tree key press against the visible rows', () => {
	const tree = buildRepositoryFileTree(['src/lib/panel.ts', 'src/app.ts', 'README.md']);
	const expanded = new Set(['src']);
	const rows = flattenRepositoryTree(tree, expanded);
	assert.deepEqual(
		rows.map(({ node }) => node.path),
		['src', 'src/lib', 'src/app.ts', 'README.md'],
	);
	const command = (key: string, active: string | null, open: ReadonlySet<string> = expanded) =>
		repositoryTreeKeyCommand(key, flattenRepositoryTree(tree, open), open, active);

	assert.deepEqual(command('ArrowDown', null), { kind: 'focus', path: 'src' });
	assert.deepEqual(command('ArrowUp', null), { kind: 'focus', path: 'README.md' });
	assert.deepEqual(command('Home', 'src/app.ts'), { kind: 'focus', path: 'src' });
	assert.deepEqual(command('End', 'src'), { kind: 'focus', path: 'README.md' });

	assert.equal(command('ArrowUp', 'src'), null);
	assert.equal(command('ArrowDown', 'README.md'), null);
	assert.deepEqual(command('ArrowDown', 'src'), { kind: 'focus', path: 'src/lib' });
	assert.deepEqual(command('ArrowUp', 'README.md'), { kind: 'focus', path: 'src/app.ts' });

	assert.deepEqual(command('ArrowRight', 'src/lib'), { kind: 'expand', path: 'src/lib' });
	assert.deepEqual(command('ArrowRight', 'src'), { kind: 'focus', path: 'src/lib' });
	assert.equal(command('ArrowRight', 'src/app.ts'), null);

	assert.deepEqual(command('ArrowLeft', 'src'), { kind: 'collapse', path: 'src' });
	assert.deepEqual(command('ArrowLeft', 'src/app.ts'), { kind: 'focus', path: 'src' });
	assert.deepEqual(command('ArrowLeft', 'src/lib'), { kind: 'focus', path: 'src' });
	assert.equal(command('ArrowLeft', 'README.md'), null);
	assert.deepEqual(command('ArrowLeft', 'src/lib/panel.ts', new Set(['src', 'src/lib'])), {
		kind: 'focus',
		path: 'src/lib',
	});

	assert.deepEqual(command('Enter', 'src/app.ts'), { kind: 'activate', path: 'src/app.ts' });
	assert.deepEqual(command('Enter', null), { kind: 'focus', path: 'src' });
	assert.equal(command('a', 'src'), null);
	assert.deepEqual(command('ArrowDown', 'src/gone.ts'), { kind: 'focus', path: 'src' });
	assert.equal(repositoryTreeKeyCommand('ArrowDown', [], new Set(), null), null);
});

test('counts an untracked tree too large to read as one change, the count the top bar reads', async () => {
	await withDom(async ({ document }) => {
		const junk = Array.from({ length: 20_000 }, (_, index) => `build-output/chunk-${index}.js`);
		const state = repositoryPanelState(
			['notes/scratch.txt', 'seed.txt', ...junk],
			['build-output/', 'notes/scratch.txt', 'seed.txt'],
		);
		const controller = new PanelTestController(state);
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);
		try {
			const topBarCount = repositorySurfaceState(state).dirtyPaths.length;
			const filter = target.querySelector<HTMLButtonElement>(
				'[aria-label="Filter to files with uncommitted changes"]',
			);
			assert.ok(filter);
			assert.equal(filter.textContent, `Changed${topBarCount}`);
			assert.equal(topBarCount, 3);

			const changes = target.querySelector<HTMLUListElement>('ul[aria-label="Changed files"]');
			assert.ok(changes);
			assert.deepEqual(
				[...changes.querySelectorAll('li')].map((item) =>
					(item.textContent ?? '').replace(/[⁦-⁩]/gu, ''),
				),
				['build-output/20,000 files', 'notes/scratch.txtModified', 'seed.txtModified'],
			);
			assert.equal(changes.querySelectorAll('button').length, 2);

			const tree = target.querySelector<HTMLElement>('[role="tree"]');
			assert.ok(tree);
			assert.equal(
				tree.querySelector('[data-path="build-output"]')?.getAttribute('aria-label'),
				'Expand directory build-output, 20,000 modified files',
			);

			filter.click();
			await new Promise<void>((resolve) => setImmediate(resolve));
			const changedTree = target.querySelector<HTMLElement>('[role="tree"]');
			assert.ok(changedTree);
			assert.equal(treeCount(target), String(topBarCount));
			const entry = changedTree.querySelector<HTMLElement>('[data-path="build-output/"]');
			assert.equal(
				entry?.getAttribute('aria-label'),
				'build-output/, untracked directory of 20,000 files, too large to show changes',
			);
			assert.equal(entry?.hasAttribute('aria-expanded'), false);
			entry?.click();
			assert.deepEqual(controller.loadedDiffPaths, []);
		} finally {
			await dispose();
		}
	});
});

test('preserves populated loading content and never renders GitHub status chrome', async () => {
	await withDom(async ({ document }) => {
		const paths = Array.from(
			{ length: 2_000 },
			(_, index) => `file-${String(index).padStart(4, '0')}.ts`,
		);
		const ready = repositoryPanelState(paths, paths.slice(0, 100));
		const controller = new PanelTestController(ready);
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);
		const instance = { dispose };

		try {
			const content = target.querySelector<HTMLElement>('.repository-panel__content');
			const changed = target.querySelector<HTMLUListElement>('ul[aria-label="Changed files"]');
			const tree = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(content);
			assert.ok(changed);
			assert.ok(tree);
			assert.equal(target.querySelector('.repository-panel__pr-strip'), null);
			assert.equal(target.querySelector('[data-command^="pull-request-"]'), null);

			controller.emit({ ...ready, status: 'loading' });
			assert.equal(target.querySelector('.repository-panel__content'), content);
			assert.equal(target.querySelector('ul[aria-label="Changed files"]'), changed);
			assert.equal(target.querySelector('.repository-panel__tree'), tree);

			controller.emit({
				...ready,
				context: {
					...ready.context!,
					pullRequest: {
						state: 'open',
						number: 42,
						title: 'Repository panel stability',
						url: 'https://example.test/pull/42',
						baseBranch: 'main',
						headBranch: 'feature/review',
						headSha: 'head-42',
						checks: 'success',
					},
				},
			});
			assert.equal(target.querySelector('.repository-panel__content'), content);
			assert.doesNotMatch(target.textContent ?? '', /#42/u);

			controller.emit({ ...ready, refreshedAt: ready.refreshedAt! + 1 });
			assert.ok(target.querySelector('.repository-panel__content'));
		} finally {
			await instance.dispose();
		}
	});
});

test('a background refresh keeps the Files tree mounted and its expanded directories open', async () => {
	await withDom(async ({ document }) => {
		const ready = repositoryPanelState(['src/lib/index.ts', 'src/app.ts', 'README.md'], []);
		const controller = new PanelTestController(ready);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const tree = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(tree);
			assert.equal(target.querySelector('[data-command="refresh"]'), null);
			assert.equal(target.querySelector('.repository-panel__section-row'), null);

			press(document, tree, 'ArrowRight');
			press(document, tree, 'ArrowRight');
			press(document, tree, 'ArrowRight');
			assert.deepEqual(treeRowPaths(target), [
				'src',
				'src/lib',
				'src/lib/index.ts',
				'src/app.ts',
				'README.md',
			]);

			await controller.refreshLocal({ addFile: 'src/lib/new.ts' });

			assert.equal(target.querySelector('.repository-panel__tree'), tree);
			assert.doesNotMatch(target.textContent ?? '', /Refreshing/u);
			assert.deepEqual(treeRowPaths(target), [
				'src',
				'src/lib',
				'src/lib/index.ts',
				'src/lib/new.ts',
				'src/app.ts',
				'README.md',
			]);
			assert.equal(tree.querySelector('[data-path="src"]')?.getAttribute('aria-expanded'), 'true');
			assert.equal(
				tree.querySelector('[data-path="src/lib"]')?.getAttribute('aria-expanded'),
				'true',
			);
			assert.equal(
				treeRowElements(tree).find((row) => row.dataset.treeActive === 'true')?.dataset.path,
				'src/lib',
			);
		} finally {
			await instance.dispose();
		}
	});
});

test('reveals the file shown in the active tab and leaves the folders the user opened or closed alone', async () => {
	await withDom(async ({ document, HTMLElement: Element }) => {
		const scrolled: string[] = [];
		Element.prototype.scrollIntoView = function (this: HTMLElement): void {
			scrolled.push(this.dataset.path ?? '');
		};
		const ready = repositoryPanelState(
			['docs/guide.md', 'src/lib/panel/state.ts', 'src/lib/panel/view.ts', 'src/app.ts'],
			[],
		);
		const controller = new PanelTestController(ready);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const tree = target.querySelector<HTMLElement>('.repository-panel__tree');
			assert.ok(tree);
			press(document, tree, 'ArrowRight');
			assert.deepEqual(treeRowPaths(target), ['docs', 'docs/guide.md', 'src']);

			controller.emit({ ...ready, selectedPath: 'src/lib/panel/state.ts' });

			assert.deepEqual(treeRowPaths(target), [
				'docs',
				'docs/guide.md',
				'src',
				'src/lib',
				'src/lib/panel',
				'src/lib/panel/state.ts',
				'src/lib/panel/view.ts',
				'src/app.ts',
			]);
			const row = (path: string): HTMLElement | undefined =>
				treeRowElements(tree).find((candidate) => candidate.dataset.path === path);
			assert.equal(row('src/lib/panel/state.ts')?.getAttribute('aria-selected'), 'true');
			assert.equal(row('src/lib/panel/state.ts')?.tabIndex, 0);
			assert.deepEqual(scrolled, ['src/lib/panel/state.ts']);

			press(document, tree, 'ArrowLeft');
			press(document, tree, 'ArrowLeft');
			assert.equal(row('src/lib/panel')?.getAttribute('aria-expanded'), 'false');
			controller.emit({ ...ready, selectedPath: 'src/lib/panel/state.ts', additions: 3 });
			assert.equal(row('src/lib/panel')?.getAttribute('aria-expanded'), 'false');
			assert.deepEqual(scrolled, ['src/lib/panel/state.ts']);

			controller.emit({ ...ready, selectedPath: null });
			controller.emit({ ...ready, selectedPath: 'src/lib/panel/view.ts' });
			assert.equal(row('src/lib/panel')?.getAttribute('aria-expanded'), 'true');
			assert.equal(row('src/lib/panel/view.ts')?.getAttribute('aria-selected'), 'true');
			assert.equal(row('docs')?.getAttribute('aria-expanded'), 'true');
			assert.deepEqual(scrolled, ['src/lib/panel/state.ts', 'src/lib/panel/view.ts']);

			const shown = treeRowPaths(target);
			controller.emit({ ...ready, selectedPath: '.github/workflows/ci.yml' });
			assert.deepEqual(treeRowPaths(target), shown);
			assert.equal(row('src/lib/panel/view.ts')?.tabIndex, 0);
			assert.deepEqual(scrolled, ['src/lib/panel/state.ts', 'src/lib/panel/view.ts']);
		} finally {
			await instance.dispose();
		}
	});
});

test('renders the Files panel as the tree alone while Changes keeps its header', async () => {
	await withDom(async ({ document }) => {
		const state: RepositoryViewState = {
			...repositoryPanelState(['src/app.ts', 'src/dirty.ts'], ['src/dirty.ts']),
			todos: [{ id: 'todo:1', text: 'Ship the panel', completed: false, createdAt: 1 }],
		};
		const controller = new PanelTestController(state);
		const api = repositoryPanelApi();
		const filesTarget = document.createElement('div');
		const changesTarget = document.createElement('div');
		const files = await createRepositoryPanel(api, controller, 'files').mount(
			filesTarget,
			repositoryPanelContext(),
		);
		const changes = await createRepositoryPanel(api, controller, 'changes').mount(
			changesTarget,
			repositoryPanelContext(),
		);

		try {
			const root = filesTarget.querySelector<HTMLElement>('.repository-panel');
			assert.ok(root);
			assert.deepEqual(
				[...root.children].map((child) => child.className),
				['repository-panel__content'],
			);
			assert.equal(filesTarget.querySelector('.repository-panel__header'), null);
			assert.equal(filesTarget.querySelector('.repository-panel__identity'), null);
			assert.equal(filesTarget.querySelector('.repository-panel__branch'), null);
			assert.equal(filesTarget.querySelector('.repository-panel__todos'), null);
			assert.equal(filesTarget.querySelector('[data-todo-input]'), null);
			assert.equal(filesTarget.querySelector('[data-todo-id]'), null);
			assert.equal(filesTarget.querySelector('[data-command^="todo"]'), null);
			assert.doesNotMatch(
				filesTarget.textContent ?? '',
				/Todos|Ship the panel|feature\/review|No todos for this workstream/u,
			);
			assert.ok(filesTarget.querySelector('.repository-panel__tree'));

			const header = changesTarget.querySelector<HTMLElement>('.repository-panel__header');
			assert.ok(header);
			assert.match(header.textContent ?? '', /Uncommitted/u);
			assert.equal(
				header.querySelector('.repository-panel__branch-head')?.textContent,
				'feature/review',
			);
			assert.equal(header.querySelector('[data-command="refresh"]'), null);
			assert.equal(changesTarget.querySelector('.repository-panel__todos'), null);
		} finally {
			await changes.dispose();
			await files.dispose();
		}
	});
});

test('a cold snapshot names what it does not know yet instead of narrating the fetch', async () => {
	await withDom(async ({ document }) => {
		const cold: RepositoryViewState = {
			...repositoryPanelState([], []),
			status: 'loading',
			refreshedAt: null,
			todoStatus: 'loading',
			todosObservedAt: null,
		};
		const controller = new PanelTestController(cold);
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);
		const instance = { dispose };

		try {
			assert.doesNotMatch(target.textContent ?? '', /Refreshing/u);
			assert.match(target.textContent ?? '', /No changes read from this workstream yet/u);
			assert.match(target.textContent ?? '', /Repository snapshot is not ready yet/u);

			controller.emit({ ...cold, status: 'ready', refreshedAt: 1, todoStatus: 'ready' });
			assert.match(target.textContent ?? '', /No uncommitted changes yet/u);
			controller.emit({ ...cold, status: 'loading', refreshedAt: 1, todoStatus: 'ready' });
			assert.match(target.textContent ?? '', /No uncommitted changes yet/u);
			assert.doesNotMatch(target.textContent ?? '', /Refreshing/u);
			controller.emit({
				...cold,
				status: 'ready',
				refreshedAt: 1,
				todoStatus: 'ready',
				diffScope: 'branch',
			});
			assert.match(target.textContent ?? '', /No changes on this branch yet/u);
		} finally {
			await instance.dispose();
		}
	});
});

test('the Uncommitted filter narrows the list, the header and the diffstat together', async () => {
	await withDom(async ({ document }) => {
		const base = repositoryPanelState(['src/committed.ts', 'src/dirty.ts'], ['src/dirty.ts']);
		const branchDiffs: RepositoryViewState['diffs'] = [
			{ path: 'src/committed.ts', additions: 40, deletions: 0, lines: [], noLineChange: null },
			{ path: 'src/dirty.ts', additions: 2, deletions: 1, lines: [], noLineChange: null },
		];
		const uncommittedDiffs: RepositoryViewState['diffs'] = [
			{ path: 'src/dirty.ts', additions: 2, deletions: 1, lines: [], noLineChange: null },
		];
		const state: RepositoryViewState = {
			...base,
			diffs: branchDiffs,
			changedFiles: 2,
			additions: 42,
			deletions: 1,
			diffScope: 'uncommitted',
			uncommitted: {
				diffs: uncommittedDiffs,
				changedFiles: 1,
				additions: 2,
				deletions: 1,
			},
		};
		const controller = new PanelTestController(state);
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);

		try {
			const rows = () =>
				[...target.querySelectorAll('[data-repository-panel="changes"] [data-path]')].map((row) =>
					row.getAttribute('data-path'),
				);
			const header = () =>
				target.querySelector('[data-repository-panel="changes"] .repository-panel__repository-name')
					?.textContent ?? '';

			assert.deepEqual(rows(), ['src/dirty.ts']);
			assert.match(header(), /Uncommitted/u);
			assert.match(header(), /\+2/u);
			assert.doesNotMatch(header(), /\+42/u);

			const chip = target.querySelector<HTMLButtonElement>(
				'[data-repository-panel="changes"] [data-command="diff-scope"]',
			);
			assert.ok(chip, 'the filter chip must be reachable');
			assert.equal(chip.getAttribute('aria-pressed'), 'true');
			chip.click();

			assert.deepEqual(controller.requestedDiffScopes, ['branch']);
			assert.deepEqual(rows(), ['src/committed.ts', 'src/dirty.ts']);
			assert.match(header(), /This branch/u);
			assert.match(header(), /\+42/u);
			const widened = target.querySelector<HTMLButtonElement>(
				'[data-repository-panel="changes"] [data-command="diff-scope"]',
			);
			assert.equal(widened?.getAttribute('aria-pressed'), 'false');

			assert.equal(
				target.querySelector('[data-repository-panel="files"]')?.textContent?.includes('dirty.ts'),
				false,
			);
		} finally {
			await dispose();
		}
	});
});

test('an empty uncommitted scope says where the committed work went', async () => {
	await withDom(async ({ document }) => {
		const state: RepositoryViewState = {
			...repositoryPanelState(['src/committed.ts'], []),
			diffs: [
				{ path: 'src/committed.ts', additions: 9, deletions: 0, lines: [], noLineChange: null },
			],
			changedFiles: 1,
			additions: 9,
			deletions: 0,
			diffScope: 'uncommitted',
			uncommitted: { diffs: [], changedFiles: 0, additions: 0, deletions: 0 },
		};
		const controller = new PanelTestController(state);
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);

		try {
			const changes = target.querySelector('[data-repository-panel="changes"]');
			assert.match(changes?.textContent ?? '', /No uncommitted changes yet/u);
			assert.match(changes?.textContent ?? '', /1 changed file already committed on this branch/u);
			assert.ok(changes?.querySelector('.malini-panel-empty-figure'));
		} finally {
			await dispose();
		}
	});
});

test('states a dead GitHub session instead of printing the failed HTTP call', async () => {
	await withDom(async ({ document }) => {
		const transport =
			'API request failed: POST /api/auth/github/refresh 502: {"message":"GitHub OAuth refresh failed: The client_id and/or client_secret passed are incorrect.","error":"Bad Gateway","statusCode":502}';
		const controller = new PanelTestController({
			...repositoryPanelState([], []),
			error: transport,
			localError: transport,
		});
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);

		try {
			const text = target.textContent ?? '';
			assert.doesNotMatch(text, /API request failed/u);
			assert.doesNotMatch(text, /statusCode/u);
			assert.doesNotMatch(text, /client_secret/u);
			assert.match(text, /GitHub session for this repository has expired/u);
			assert.match(text, /Reconnect GitHub/u);
		} finally {
			await dispose();
		}
	});
});

test('leaves an unclassified failure exactly as it arrived', async () => {
	await withDom(async ({ document }) => {
		const controller = new PanelTestController({
			...repositoryPanelState([], []),
			error: 'fatal: unable to access the worktree index',
			localError: 'fatal: unable to access the worktree index',
		});
		const { target, dispose } = await mountBothRepositoryPanels(document, controller);

		try {
			assert.match(target.textContent ?? '', /fatal: unable to access the worktree index/u);
		} finally {
			await dispose();
		}
	});
});

test('keeps deleted and binary dirty paths visible when no textual diff is available', () => {
	assert.deepEqual(
		repositoryChangeFileRows({
			context: { ...repositoryContext, dirtyPaths: ['assets/removed.bin'] },
			files: [],
			diffs: [],
		}),
		[
			{
				path: 'assets/removed.bin',
				changed: true,
				diffAvailable: false,
				additions: 0,
				deletions: 0,
				noLineChange: null,
			},
		],
	);
});

test('opens a new file diff as the one line the file has, with no metadata rows', async () => {
	await withDom(async ({ document }) => {
		const { target, dispose } = await mountOpenedDiff(
			document,
			renderRepositoryDiff({
				path: 'PARITY-CHECK.md',
				patch: gitPatch(
					'diff --git a/PARITY-CHECK.md b/PARITY-CHECK.md',
					'new file mode 100644',
					'index 00000000..891b3267',
					'--- /dev/null',
					'+++ b/PARITY-CHECK.md',
					'@@ -0,0 +1 @@',
					'+parity e2e run',
				),
				additions: 1,
				deletions: 0,
			}),
		);

		try {
			assert.deepEqual(diffGrid(target), [['', '1', '+ parity e2e run']]);
			const diff = target.querySelector('.repository-panel__diff')?.textContent ?? '';
			assert.doesNotMatch(diff, /new file mode|index 00000000|dev\/null|@@/u);
		} finally {
			await dispose();
		}
	});
});

test('numbers the second hunk of a diff from its own header, not from the first one', async () => {
	await withDom(async ({ document }) => {
		const { target, dispose } = await mountOpenedDiff(
			document,
			renderRepositoryDiff({
				path: 'many.txt',
				patch: gitPatch(
					'diff --git a/many.txt b/many.txt',
					'index 68745ba1..7e22d2a9 100644',
					'--- a/many.txt',
					'+++ b/many.txt',
					'@@ -1,3 +1,3 @@',
					' alpha',
					'-beta',
					'+BETA',
					' gamma',
					'@@ -17,3 +17,3 @@ pi',
					' tau',
					'-upsilon',
					'+UPSILON',
					' phi',
				),
				additions: 2,
				deletions: 2,
			}),
		);

		try {
			assert.deepEqual(diffGrid(target), [
				['1', '1', '  alpha'],
				['2', '', '− beta'],
				['', '2', '+ BETA'],
				['3', '3', '  gamma'],
				['17', '17', '  tau'],
				['18', '', '− upsilon'],
				['', '18', '+ UPSILON'],
				['19', '19', '  phi'],
			]);
			assert.doesNotMatch(
				target.querySelector('.repository-panel__diff')?.textContent ?? '',
				/index 68745ba1|many\.txt b\/|@@/u,
			);
		} finally {
			await dispose();
		}
	});
});

test('opens a deleted file diff against the left gutter alone', async () => {
	await withDom(async ({ document }) => {
		const { target, dispose } = await mountOpenedDiff(
			document,
			renderRepositoryDiff({
				path: 'gone.txt',
				patch: gitPatch(
					'diff --git a/gone.txt b/gone.txt',
					'deleted file mode 100644',
					'index 290a7fd0..00000000',
					'--- a/gone.txt',
					'+++ /dev/null',
					'@@ -1,2 +0,0 @@',
					'-to be deleted',
					'-second line',
				),
				additions: 0,
				deletions: 2,
			}),
		);

		try {
			assert.deepEqual(diffGrid(target), [
				['1', '', '− to be deleted'],
				['2', '', '− second line'],
			]);
			assert.doesNotMatch(
				target.querySelector('.repository-panel__diff')?.textContent ?? '',
				/deleted file mode|index 290a7fd0|dev\/null/u,
			);
		} finally {
			await dispose();
		}
	});
});

test('opens a renamed file diff on the lines that moved, not on the rename headers', async () => {
	await withDom(async ({ document }) => {
		const { target, dispose } = await mountOpenedDiff(
			document,
			renderRepositoryDiff({
				path: 'src/new-name.ts',
				patch: gitPatch(
					'diff --git a/src/old-name.ts b/src/new-name.ts',
					'similarity index 87%',
					'rename from src/old-name.ts',
					'rename to src/new-name.ts',
					'index 3b18e510..a1b2c3d4 100644',
					'--- a/src/old-name.ts',
					'+++ b/src/new-name.ts',
					'@@ -4,2 +4,2 @@ export function value() {',
					'-const before = 1;',
					'+const after = 2;',
					' return before;',
				),
				additions: 1,
				deletions: 1,
			}),
		);

		try {
			assert.deepEqual(diffGrid(target), [
				['4', '', '− const before = 1;'],
				['', '4', '+ const after = 2;'],
				['5', '5', '  return before;'],
			]);
			assert.doesNotMatch(
				target.querySelector('.repository-panel__diff')?.textContent ?? '',
				/similarity index|rename from|rename to|index 3b18e510/u,
			);
		} finally {
			await dispose();
		}
	});
});

test('states why a patch with no hunk has nothing to show instead of drawing an empty grid', async () => {
	const cases = [
		{
			path: 'assets/logo.png',
			patch: gitPatch(
				'diff --git a/assets/logo.png b/assets/logo.png',
				'index 67357440..b036c4a1 100644',
				'Binary files a/assets/logo.png and b/assets/logo.png differ',
			),
			statement: 'Binary file changed; no textual diff is available.',
		},
		{
			path: 'scripts/run.sh',
			patch: gitPatch(
				'diff --git a/scripts/run.sh b/scripts/run.sh',
				'old mode 100644',
				'new mode 100755',
			),
			statement: 'File mode changed; no lines were added or removed.',
		},
		{
			path: 'src/new-name.ts',
			patch: gitPatch(
				'diff --git a/src/old-name.ts b/src/new-name.ts',
				'similarity index 100%',
				'rename from src/old-name.ts',
				'rename to src/new-name.ts',
			),
			statement: 'File renamed; no lines were added or removed.',
		},
	];

	for (const { path, patch, statement } of cases) {
		await withDom(async ({ document }) => {
			const { target, dispose } = await mountOpenedDiff(
				document,
				renderRepositoryDiff({ path, patch, additions: 0, deletions: 0 }),
			);

			try {
				assert.equal(target.querySelector('.repository-panel__diff-table'), null);
				assert.equal(
					target.querySelector('.repository-panel__diff-statement')?.textContent,
					statement,
				);
				assert.doesNotMatch(
					target.querySelector('.repository-panel__diff')?.textContent ?? '',
					/diff --git|index |mode 100|rename |Binary files/u,
				);
			} finally {
				await dispose();
			}
		});
	}
});

test('renders one syntax-highlighted net chat diff instead of sequential runs or current dirt', async () => {
	await withDom(async ({ document }) => {
		const ready = repositoryPanelState(['src/app.ts', 'src/unrelated.ts'], ['src/unrelated.ts']);
		const state: RepositoryViewState = {
			...ready,
			selectedPath: 'src/app.ts',
			diff: {
				path: 'src/unrelated.ts',
				additions: 1,
				deletions: 0,
				noLineChange: null,
				lines: [{ kind: 'addition', oldLine: null, newLine: 1, text: 'live dirt' }],
			},
			agentSessionDiff: {
				sessionId: 'session-1',
				path: 'src/app.ts',
				additions: 2,
				deletions: 1,
				isBinary: false,
				contributingRunIds: ['run-1', 'run-2'],
				net: {
					beforeCommit: '111111111',
					afterCommit: '444444444',
					capturedAt: '2026-07-22T08:05:00Z',
					diff: {
						path: 'src/app.ts',
						additions: 2,
						deletions: 1,
						noLineChange: null,
						lines: [
							{
								kind: 'deletion',
								oldLine: 1,
								newLine: null,
								text: 'export const firstRun = true;',
							},
							{
								kind: 'addition',
								oldLine: null,
								newLine: 1,
								text: 'export const secondRun = true; // current',
							},
						],
					},
				},
				turns: [],
			},
		};
		const controller = new PanelTestController(state);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const sessionDiff = target.querySelector<HTMLElement>(
				'.repository-panel__agent-session-diff',
			);
			assert.ok(sessionDiff);
			assert.equal(sessionDiff.dataset.sessionId, 'session-1');
			assert.equal(sessionDiff.dataset.path, 'src/app.ts');
			assert.equal(target.querySelectorAll('[data-contributing-run-count="2"]').length, 1);
			assert.match(sessionDiff.textContent ?? '', /firstRun/u);
			assert.match(sessionDiff.textContent ?? '', /secondRun/u);
			assert.doesNotMatch(sessionDiff.textContent ?? '', /live dirt/u);
			assert.ok(sessionDiff.querySelector('.tok-keyword'));
			assert.ok(sessionDiff.querySelector('.tok-comment'));
			assert.equal(sessionDiff.querySelectorAll('.repository-panel__line-number').length, 4);
		} finally {
			await instance.dispose();
		}
	});
});

test('renders a file the chat could not compose as one titled section per turn', async () => {
	await withDom(async ({ document }) => {
		const ready = repositoryPanelState(['notes.txt'], ['notes.txt']);
		const turnDiff = (oldText: string | null, newText: string) => ({
			path: 'notes.txt',
			additions: 1,
			deletions: oldText === null ? 0 : 1,
			noLineChange: null,
			lines: [
				...(oldText === null
					? []
					: [{ kind: 'deletion' as const, oldLine: 1, newLine: null, text: oldText }]),
				{ kind: 'addition' as const, oldLine: null, newLine: 1, text: newText },
			],
		});
		const state: RepositoryViewState = {
			...ready,
			selectedPath: 'notes.txt',
			agentSessionDiff: {
				sessionId: 'session-1',
				path: 'notes.txt',
				additions: 2,
				deletions: 1,
				isBinary: false,
				contributingRunIds: ['run-1', 'run-2'],
				net: {
					beforeCommit: '111111111',
					afterCommit: '444444444',
					capturedAt: '2026-07-22T08:05:00Z',
					diff: null,
				},
				turns: [
					{
						runId: 'run-1',
						turn: 1,
						title: 'Write the notes',
						beforeCommit: '111111111',
						afterCommit: '222222222',
						diff: turnDiff(null, 'agent one'),
					},
					{
						runId: 'run-2',
						turn: 3,
						title: null,
						beforeCommit: '333333333',
						afterCommit: '444444444',
						diff: turnDiff('written by hand', 'agent two'),
					},
				],
			},
		};
		const controller = new PanelTestController(state);
		const target = document.createElement('div');
		const instance = await createRepositoryPanel(repositoryPanelApi(), controller).mount(
			target,
			repositoryPanelContext(),
		);

		try {
			const headings = [...target.querySelectorAll('h3')].map((heading) => heading.textContent);
			assert.deepEqual(headings, ['Turn 1 · Write the notes', 'Turn 3']);
			assert.doesNotMatch(target.textContent ?? '', /Net chat change/u);
			const sections = [...target.querySelectorAll('article')];
			assert.equal(sections.length, 2);
			assert.match(sections[0]?.textContent ?? '', /agent one/u);
			assert.doesNotMatch(sections[0]?.textContent ?? '', /agent two/u);
			assert.match(sections[1]?.textContent ?? '', /written by hand[\s\S]*agent two/u);
		} finally {
			await instance.dispose();
		}
	});
});

test('panel source preserves the hierarchical visual contract with semantic tokens', async () => {
	const source = await readFile('src/panel.ts', 'utf8');
	const unifiedFilesRenderer = source.slice(
		source.indexOf('#renderFiles('),
		source.indexOf('#renderTreeRow('),
	);
	assert.ok(unifiedFilesRenderer.indexOf('#renderChangedFilesSection') >= 0);
	assert.ok(
		unifiedFilesRenderer.indexOf('#renderChangedFilesSection') <
			unifiedFilesRenderer.indexOf('#renderTreeSection'),
		'changed files must render before the remaining repository tree',
	);
	assert.match(source, /#renderHeader\(\): HTMLElement/u);
	assert.match(source, /repository-panel__branch-sync/u);
	assertBranchSyncGlyphsHaveReservedSpace(source);
	assert.doesNotMatch(source, /repository-panel__context/u);
	assert.match(unifiedFilesRenderer, /aria-expanded/u);
	assert.doesNotMatch(source, /repository-panel__todo/u);
	assert.doesNotMatch(source, /todoStatus|todoError|state\.todos/u);
	assert.doesNotMatch(source, /repositoryTodoOpenCount|REPOSITORY_TODO_LIMITS/u);
	assert.match(unifiedFilesRenderer, /title: 'Files'/u);
	assert.doesNotMatch(source, /title: 'Changed'/u);
	assert.match(source, /role', 'tree'/u);
	assert.match(source, /aria-expanded/u);
	assert.match(source, /aria-level/u);
	assert.match(source, /repository-panel__twisty/u);
	assert.match(source, /repository-panel__file-icon/u);
	assert.match(source, /repository-panel__folder/u);
	assert.match(source, /from '@malini\/extension-api'/u);
	assert.doesNotMatch(source, /repositoryFileIcon/u);
	assert.doesNotMatch(source, /\btone:\s*'(brand|muted|accent|info)'/u);
	assert.doesNotMatch(source, /file-icon\[data-tone/u);
	assert.match(source, /aria-pressed/u);
	assert.match(source, /role', 'alert'/u);
	assert.match(source, /--tree-depth/u);
	assert.match(source, /repeating-linear-gradient/u);
	assert.doesNotMatch(source, /show-more|showMore|ROW_WINDOW/u);
	assert.doesNotMatch(source, /font-size: 0\.[0-6]/u);
	assert.doesNotMatch(source, /font-size: \d+px/u);
	assert.doesNotMatch(source, /Pull request title|Commit message|Confirm commit and push/u);
	assert.equal(source.match(/pullrequest|pull-request|checks|merge/giu), null);
	assert.match(source, /repositoryInteractionScope/u);
	assert.match(source, /Unified diff/u);
	assert.match(source, /var\(--color-fg-default\)/u);
	assert.doesNotMatch(source, /Filter files|repository-panel__search/u);
	assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/iu);
});

class PanelTestController {
	#state: RepositoryViewState;
	#listeners = new Set<(state: RepositoryViewState) => void>();
	selectedPaths: string[] = [];
	loadedDiffPaths: string[] = [];
	requestedDiffScopes: RepositoryViewState['diffScope'][] = [];
	refreshCalls = 0;
	refreshPullRequestCalls = 0;

	constructor(state: RepositoryViewState) {
		this.#state = state;
	}

	snapshot(): RepositoryViewState {
		return this.#state;
	}

	workstreamState(): RepositoryViewState {
		return this.#state;
	}

	subscribeWorkstreamPreviews(): { dispose(): void } {
		return { dispose: () => undefined };
	}

	showFile(): void {}

	hideFile(): void {}

	subscribe(listener: (state: RepositoryViewState) => void): { dispose(): void } {
		this.#listeners.add(listener);
		listener(this.#state);
		return {
			dispose: () => {
				this.#listeners.delete(listener);
			},
		};
	}

	emit(state: RepositoryViewState): void {
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}

	closeAgentSessionDiff(): RepositoryViewState {
		this.#state = { ...this.#state, agentSessionDiff: null };
		for (const listener of this.#listeners) listener(this.#state);
		return this.#state;
	}

	setDiffScope(scope: RepositoryViewState['diffScope']): RepositoryViewState {
		this.requestedDiffScopes.push(scope);
		this.#state = { ...this.#state, diffScope: scope, diff: null };
		for (const listener of this.#listeners) listener(this.#state);
		return this.#state;
	}

	async refresh(): Promise<RepositoryViewState> {
		this.refreshCalls += 1;
		return this.#state;
	}

	async refreshLocal(options: { addFile?: string } = {}): Promise<RepositoryViewState> {
		this.refreshCalls += 1;
		this.emit({ ...this.#state, status: 'loading' });
		await new Promise<void>((resolve) => setImmediate(resolve));
		const files = options.addFile
			? [
					...this.#state.files,
					{ path: options.addFile, name: options.addFile, directory: '', extension: 'ts' },
				]
			: this.#state.files;
		this.emit({
			...this.#state,
			status: 'ready',
			files,
			refreshedAt: (this.#state.refreshedAt ?? 0) + 1,
		});
		return this.#state;
	}

	async selectFile(path: unknown): Promise<RepositoryViewState> {
		this.selectedPaths.push(String(path));
		this.#state = { ...this.#state, selectedPath: String(path) };
		for (const listener of this.#listeners) listener(this.#state);
		return this.#state;
	}

	async loadDiff(path: unknown): Promise<RepositoryViewState> {
		this.loadedDiffPaths.push(String(path));
		return this.#state;
	}

	async refreshPullRequest(): Promise<RepositoryViewState> {
		this.refreshPullRequestCalls += 1;
		return this.#state;
	}
}

function repositoryPanelApi(): RepositoryPanelHost {
	return {
		manifest: { id: 'malini.repository' },
		notifications: { show: async () => undefined },
		workstream: { readFile: async () => '' },
		panels: {
			register: () => {
				throw new Error('The repository panel tests do not register panels');
			},
			open: () => {
				throw new Error('The repository panel tests do not open panels');
			},
		},
	};
}

function repositoryPanelContext(): ExtensionPanelContext {
	return {
		workstream: null,
		settings: {},
		executeCommand: async () => {
			throw new Error('The repository panel tests do not execute commands');
		},
	};
}

function repositoryPanelState(
	paths: readonly string[],
	dirtyPaths: readonly string[],
): RepositoryViewState {
	return {
		status: 'ready',
		context: {
			...repositoryContext,
			dirtyPaths: [...dirtyPaths],
		},
		files: paths.map((path) => ({
			path,
			name: path,
			directory: '',
			extension: 'ts',
		})),
		selectedPath: null,
		selectedContents: null,
		diff: null,
		diffs: [],
		agentSessionDiff: null,
		changedFiles: dirtyPaths.length,
		additions: 0,
		deletions: 0,
		diffScope: 'uncommitted',
		uncommitted: { diffs: [], changedFiles: dirtyPaths.length, additions: 0, deletions: 0 },
		refreshedAt: 1,
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todos: [],
		todoStatus: 'ready',
		todosObservedAt: 1,
		todoError: null,
	};
}

function gitPatch(...lines: readonly string[]): string {
	return `${lines.join('\n')}\n`;
}

async function mountOpenedDiff(
	document: Document,
	diff: RepositoryViewState['diff'] & {},
): Promise<{ target: HTMLElement; dispose: () => Promise<void> }> {
	const controller = new PanelTestController({
		...repositoryPanelState([], [diff.path]),
		diffs: [diff],
		uncommitted: {
			diffs: [diff],
			changedFiles: 1,
			additions: diff.additions,
			deletions: diff.deletions,
		},
		diff,
	});
	const target = document.createElement('div');
	const instance = await createRepositoryPanel(repositoryPanelApi(), controller, 'changes').mount(
		target,
		repositoryPanelContext(),
	);
	target.querySelector<HTMLButtonElement>(`[data-path="${diff.path}"]`)?.click();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.ok(target.querySelector('.repository-panel__diff-view'), 'the diff view must be open');
	return {
		target,
		dispose: async () => {
			await instance.dispose();
		},
	};
}

function treeRowElements(tree: HTMLElement): HTMLElement[] {
	return [...tree.children].filter(isHtmlElement);
}

function isHtmlElement(node: Element): node is HTMLElement {
	return node instanceof HTMLElement;
}

function treeRowPaths(target: HTMLElement): string[] {
	return [...target.querySelectorAll<HTMLElement>('.repository-panel__tree > [data-path]')].map(
		(row) => row.dataset.path ?? '',
	);
}

function treeCount(target: HTMLElement): string {
	return (
		target.querySelector<HTMLElement>(
			'.repository-panel__files-section--all .repository-panel__section-summary',
		)?.textContent ?? ''
	);
}

function diffGrid(target: HTMLElement): string[][] {
	return [...target.querySelectorAll('.repository-panel__diff-table tbody tr')].map((row) =>
		[...row.children].map((cell) => cell.textContent ?? ''),
	);
}

function press(document: Document, target: HTMLElement, key: string): void {
	const view = document.defaultView;
	assert.ok(view);
	target.dispatchEvent(new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function assertBranchSyncGlyphsHaveReservedSpace(source: string): void {
	const rule = (selector: string): string => {
		const start = source.indexOf(`${selector} {`);
		assert.ok(start >= 0, `${selector} must exist`);
		return source.slice(start, source.indexOf('}', start));
	};
	for (const selector of ['.repository-panel__identity', '.repository-panel__branch']) {
		assert.match(
			rule(selector),
			/overflow: hidden/u,
			`${selector} must clip so the upstream glyphs cannot paint over the refresh control`,
		);
	}
	assert.match(rule('.repository-panel__branch'), /max-width: 100%/u);
	assert.match(rule('.repository-panel__branch-sync'), /white-space: nowrap/u);
	for (const selector of ['.repository-panel__branch-head', '.repository-panel__branch-base']) {
		assert.match(
			source.slice(source.indexOf(`${selector} {`)).slice(0, 200),
			/flex: 0 [12] auto/u,
			`${selector} must yield before the upstream glyphs do`,
		);
	}
}

async function mountBothRepositoryPanels(
	document: Document,
	controller: PanelTestController,
): Promise<{ target: HTMLElement; dispose: () => Promise<void> }> {
	const target = document.createElement('div');
	const api = repositoryPanelApi();
	const instances: ExtensionPanelInstance[] = [];
	for (const mode of ['changes', 'files'] as const) {
		const host = document.createElement('div');
		target.append(host);
		instances.push(
			await createRepositoryPanel(api, controller, mode).mount(host, repositoryPanelContext()),
		);
	}
	return {
		target,
		dispose: async () => {
			for (const instance of instances.reverse()) await instance.dispose();
		},
	};
}
