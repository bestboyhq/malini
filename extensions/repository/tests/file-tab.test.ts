import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type {
	ExtensionPanelContext,
	ExtensionPanelInstance,
	ExtensionPanelRegistration,
	ExtensionRepositoryDiff,
} from '@malini/extension-api';
import { createTestHost as createHost } from '@malini/extension-api/test';
import { repositoryFileTabRows } from '../src/file-tab.js';
import extension from '../src/index.js';
import type { DOMWindow } from 'jsdom';
import { withDom } from './dom.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

const FILE_TEMPLATE_ID = 'malini.repository.file';
const FILE_PANEL_ID = 'malini.repository.file:src/app.ts';
const PANELS = [FILE_TEMPLATE_ID, 'malini.repository.files-panel'];

async function hostWithRepository() {
	return createHost({
		manifest,
		fixtureRepository: {
			name: 'file-tabs',
			files: { 'src/app.ts': 'export const answer = 42;\n', 'README.md': 'docs\n' },
		},
	});
}

test('opening a file asks the host for a tab named after it, not for a panel of its own', async () => {
	const host = await hostWithRepository();
	try {
		await host.activate(extension);
		assert.deepEqual(host.snapshot().panels, PANELS);

		await host.invokeCommand('malini.repository.open-file', { path: 'src/app.ts' });

		assert.deepEqual(host.snapshot().panels, PANELS);
		assert.deepEqual(openedTabs(host), [
			{ panelId: FILE_PANEL_ID, label: 'app.ts', icon: 'path:src/app.ts', tooltip: 'src/app.ts' },
		]);
	} finally {
		await host.cleanup();
	}
});

test('opening the same file twice asks for the same tab', async () => {
	const host = await hostWithRepository();
	try {
		await host.activate(extension);
		await host.invokeCommand('malini.repository.open-file', { path: 'src/app.ts' });
		await host.invokeCommand('malini.repository.open-file', { path: 'src/app.ts', line: 3 });

		assert.deepEqual(
			openedTabs(host).map(({ panelId }) => panelId),
			[FILE_PANEL_ID, FILE_PANEL_ID],
		);
		assert.deepEqual(host.snapshot().panels, PANELS);
	} finally {
		await host.cleanup();
	}
});

test('a path the worktree does not have is refused before any tab is asked for', async () => {
	const host = await hostWithRepository();
	try {
		await host.activate(extension);
		await assert.rejects(
			host.invokeCommand('malini.repository.open-file', { path: 'src/gone.ts' }),
		);
		assert.deepEqual(openedTabs(host), []);
	} finally {
		await host.cleanup();
	}
});

test('a file named by its name alone opens the one file with that name, at the line asked for', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-bare-name',
				files: {
					'src/git/remote.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
					'packages/a/index.ts': 'a\n',
					'packages/b/index.ts': 'b\n',
				},
			},
		});
		try {
			await host.activate(extension);

			await host.invokeCommand('malini.repository.open-file', { path: 'remote.ts', line: 2 });

			assert.deepEqual(openedTabs(host), [
				{
					panelId: 'malini.repository.file:src/git/remote.ts',
					label: 'remote.ts',
					icon: 'path:src/git/remote.ts',
					tooltip: 'src/git/remote.ts',
				},
			]);
			assert.equal(await selectedPath(host), 'src/git/remote.ts');
			const tab = await mountFileTab(host, window, 'src/git/remote.ts', null, false);
			try {
				const current = tab.lines.querySelector<HTMLElement>('[data-current-line="true"]');
				assert.equal(current?.dataset['line'], '2');
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('a dotfile opens selected in the Files tree, but git internals and paths outside never open', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-hidden',
				files: {
					'.github/workflows/ci.yml': 'on: push\n',
					'.git/config': '[core]\n',
					'src/app.ts': 'export const answer = 42;\n',
				},
			},
		});
		try {
			await host.activate(extension);

			await host.invokeCommand('malini.repository.open-file', {
				path: '.github/workflows/ci.yml',
			});

			assert.deepEqual(openedTabs(host), [
				{
					panelId: 'malini.repository.file:.github/workflows/ci.yml',
					label: 'ci.yml',
					icon: 'path:.github/workflows/ci.yml',
					tooltip: '.github/workflows/ci.yml',
				},
			]);
			assert.equal(await selectedPath(host), '.github/workflows/ci.yml');
			const tab = await mountFileTab(host, window, '.github/workflows/ci.yml', null, false);
			try {
				const segments = [...tab.root.querySelectorAll('nav[aria-label="File path"] li')].map(
					(segment) => segment.textContent,
				);
				assert.deepEqual(segments, ['.github', 'workflows', 'ci.yml']);
				assert.match(tab.lines.textContent ?? '', /on: push/u);
				assert.equal(await selectedPath(host), '.github/workflows/ci.yml');
			} finally {
				await tab.instance.dispose();
			}

			await assert.rejects(
				host.invokeCommand('malini.repository.open-file', { path: '.git/config' }),
				/No file in this workstream matches \.git\/config/u,
			);
			await assert.rejects(
				host.invokeCommand('malini.repository.open-file', { path: '../outside.txt' }),
				/Invalid repository-relative path/u,
			);
			assert.equal(openedTabs(host).length, 1);
		} finally {
			await host.cleanup();
		}
	});
});

test('a name several files share, or that only ends a longer name, opens nothing', async () => {
	const host = await createHost({
		manifest,
		fixtureRepository: {
			name: 'file-tab-unresolved-name',
			files: {
				'src/git/remote.ts': 'export const remote = 1;\n',
				'packages/a/index.ts': 'a\n',
				'packages/b/index.ts': 'b\n',
			},
		},
	});
	try {
		await host.activate(extension);

		await assert.rejects(
			host.invokeCommand('malini.repository.open-file', { path: 'index.ts' }),
			/index\.ts matches 2 files: packages\/a\/index\.ts, packages\/b\/index\.ts/u,
		);
		await assert.rejects(
			host.invokeCommand('malini.repository.open-file', { path: 'ote.ts' }),
			/No file in this workstream matches ote\.ts/u,
		);
		assert.deepEqual(openedTabs(host), []);
	} finally {
		await host.cleanup();
	}
});

test('deactivating withdraws the file tab template', async () => {
	const host = await hostWithRepository();
	try {
		await host.activate(extension);
		await host.invokeCommand('malini.repository.open-file', { path: 'src/app.ts' });

		await host.deactivate();

		assert.deepEqual(host.snapshot().panels, []);
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('a tab shows the file its instance key names, under its path', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.equal(tab.root.getAttribute('aria-label'), 'Contents of src/app.ts');
				const segments = [...tab.root.querySelectorAll('nav[aria-label="File path"] li')].map(
					(segment) => segment.textContent,
				);
				assert.deepEqual(segments, ['src', 'app.ts']);
				assert.match(tab.lines.textContent ?? '', /export const answer = 42;/u);
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('a line asked for before the tab mounts is the line it shows once mounted', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-line',
				files: { 'src/three.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n' },
			},
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/three.ts', 2);
			try {
				const current = tab.lines.querySelector<HTMLElement>('[data-current-line="true"]');
				assert.equal(current?.dataset['line'], '2');
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('the files tree marks the file whose tab is on screen, and only while it is', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const app = await mountFileTab(host, window, 'src/app.ts');
			await app.instance.dispose();
			assert.equal(await selectedPath(host), null);

			const readme = await mountFileTab(host, window, 'README.md', null, false);
			assert.equal(await selectedPath(host), 'README.md');
			await readme.instance.dispose();
			assert.equal(await selectedPath(host), null);
		} finally {
			await host.cleanup();
		}
	});
});

test('the line-number gutter is the same width in a 3-line file and a 1,500-line file', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-gutter',
				files: {
					'src/short.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
					'src/long.ts': `${Array.from(
						{ length: 1_500 },
						(_, index) => `const line${String(index)} = ${String(index)};`,
					).join('\n')}\n`,
				},
			},
		});
		try {
			await host.activate(extension);
			const short = await mountFileTab(host, window, 'src/short.ts');
			const long = await mountFileTab(host, window, 'src/long.ts');
			try {
				assert.equal(short.lines.children.length, 4);
				assert.equal(long.lines.children.length, 1_501);
				assert.equal(short.lines.getAttribute('style'), null);
				assert.equal(long.lines.getAttribute('style'), null);

				const rule = gutterRule(window);
				assert.match(rule, /width: calc\(5ch \+ 1\.5rem\)/u);
				assert.doesNotMatch(rule, /var\(--gutter-width/u);
			} finally {
				await long.instance.dispose?.();
				await short.instance.dispose?.();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('removed lines sit where they were cut, before what replaced them, and trailing ones end the file', () => {
	const diff = {
		lines: [
			{ kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
			{ kind: 'deletion', oldLine: 2, newLine: null, text: 'b' },
			{ kind: 'addition', oldLine: null, newLine: 2, text: 'B' },
			{ kind: 'addition', oldLine: null, newLine: 3, text: 'B2' },
			{ kind: 'context', oldLine: 3, newLine: 4, text: 'c' },
			{ kind: 'deletion', oldLine: 9, newLine: null, text: 'i' },
			{ kind: 'deletion', oldLine: 10, newLine: null, text: 'j' },
		],
	} as const;

	assert.deepEqual(repositoryFileTabRows(10, diff), [
		{ kind: 'line', line: 1, added: false },
		{ kind: 'removed', line: 2, text: 'b' },
		{ kind: 'line', line: 2, added: true },
		{ kind: 'line', line: 3, added: true },
		...[4, 5, 6, 7, 8, 9].map((line) => ({ kind: 'line', line, added: false })),
		{ kind: 'removed', line: 9, text: 'i' },
		{ kind: 'removed', line: 10, text: 'j' },
		{ kind: 'line', line: 10, added: false },
	]);
	assert.deepEqual(repositoryFileTabRows(2, null), [
		{ kind: 'line', line: 1, added: false },
		{ kind: 'line', line: 2, added: false },
	]);
});

test('a changed file shows its uncommitted lines in place and counts them over the contents', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-changes',
				files: { 'src/app.ts': 'const a = 1;\nconst b = 3;\nconst c = 3;\n' },
			},
			repository: {
				status: { dirtyPaths: ['src/app.ts'] },
				uncommittedDiffs: [replacement('src/app.ts', 2, 'const b = 2;', 'const b = 3;')],
			},
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.deepEqual(rowTexts(tab.lines), [
					'1 const a = 1;',
					'2 Removed: const b = 2;',
					'2 Added: const b = 3;',
					'3 const c = 3;',
					'4  ',
				]);
				const stat = tab.root.querySelector<HTMLElement>('[aria-label$="since the last commit"]');
				assert.equal(
					stat?.getAttribute('aria-label'),
					'1 line added, 1 line removed since the last commit',
				);
				assert.equal(stat?.textContent, '+1−1');
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('an open tab follows the file when the tree reads a new change to it', async () => {
	await withDom(async (window) => {
		const repository: {
			status: { dirtyPaths: string[] };
			uncommittedDiffs: ExtensionRepositoryDiff[];
		} = {
			status: { dirtyPaths: [] },
			uncommittedDiffs: [],
		};
		const host = await createHost({
			manifest,
			fixtureRepository: { name: 'file-tab-follow', files: { 'src/app.ts': 'const b = 2;\n' } },
			repository,
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.deepEqual(rowTexts(tab.lines), ['1 const b = 2;', '2  ']);

				await host.api.workstream.writeFile('src/app.ts', 'const b = 3;\n');
				repository.status.dirtyPaths = ['src/app.ts'];
				repository.uncommittedDiffs = [
					replacement('src/app.ts', 1, 'const b = 2;', 'const b = 3;'),
				];
				await host.invokeCommand('malini.repository.refresh');

				const lines = await eventually(() => {
					const shown = tab.root.querySelector<HTMLElement>('.repository-file-tab__lines');
					return shown && rowTexts(shown).length === 3 ? shown : null;
				});
				assert.deepEqual(rowTexts(lines), [
					'1 Removed: const b = 2;',
					'1 Added: const b = 3;',
					'2  ',
				]);
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

function replacement(
	path: string,
	line: number,
	before: string,
	after: string,
): ExtensionRepositoryDiff {
	return {
		path,
		patch: [
			`diff --git a/${path} b/${path}`,
			`--- a/${path}`,
			`+++ b/${path}`,
			`@@ -${String(line)} +${String(line)} @@`,
			`-${before}`,
			`+${after}`,
		].join('\n'),
		additions: 1,
		deletions: 1,
	};
}

function rowTexts(lines: HTMLElement): readonly string[] {
	return [...lines.children].map((row) => {
		const [gutter, ...cells] = row.children;
		return `${gutter?.textContent ?? ''} ${cells.map((cell) => cell.textContent).join('')}`;
	});
}

async function eventually<T>(read: () => T | null): Promise<T> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const value = read();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('The tab never showed the change');
}

async function mountFileTab(
	host: Awaited<ReturnType<typeof createHost>>,
	window: DOMWindow,
	path: string,
	line: number | null = null,
	opened = true,
): Promise<{ instance: ExtensionPanelInstance; root: HTMLElement; lines: HTMLElement }> {
	if (opened) await host.invokeCommand('malini.repository.open-file', { path, line });
	const panel = registeredPanel(host, FILE_TEMPLATE_ID);
	const target = window.document.createElement('div');
	window.document.body.append(target);
	const instance = await panel.component.mount(target, fileTabContext(path));
	const root = target.querySelector<HTMLElement>('.repository-file-tab');
	const lines = target.querySelector<HTMLElement>('.repository-file-tab__lines');
	assert.ok(root && lines, `${path} rendered its lines`);
	return { instance, root, lines };
}

function fileTabContext(instanceKey: string): ExtensionPanelContext {
	return {
		workstream: null,
		settings: {},
		instanceKey,
		executeCommand: async () => {
			throw new Error('The file tab tests do not execute commands');
		},
	};
}

async function selectedPath(host: Awaited<ReturnType<typeof createHost>>): Promise<unknown> {
	const status = await host.invokeCommand<{ selectedPath?: unknown }>('malini.repository.status');
	return status.selectedPath;
}

function openedTabs(
	host: Awaited<ReturnType<typeof createHost>>,
): readonly Readonly<{ panelId?: string; label?: string; icon?: string }>[] {
	return host
		.recording()
		.filter((entry) => entry.kind === 'panels.open')
		.map((entry) => entry.payload as { panelId?: string; label?: string; icon?: string });
}

function gutterRule(window: DOMWindow): string {
	const sheet = window.document.querySelector<HTMLElement>(
		'style[data-malini-panel-styles="malini.repository.file"]',
	);
	assert.ok(sheet, 'the file tab stylesheet is installed');
	const css = sheet.textContent ?? '';
	const start = css.indexOf('.repository-file-tab__gutter {');
	assert.ok(start >= 0, 'the gutter rule exists');
	return css.slice(start, css.indexOf('}', start));
}

function registeredPanel(
	host: Awaited<ReturnType<typeof createHost>>,
	panelId: string,
): ExtensionPanelRegistration {
	const panel = host.snapshot().panelRegistrations[panelId];
	assert.ok(panel, `panel ${panelId} is registered`);
	return panel;
}
