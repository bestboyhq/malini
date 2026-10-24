import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {
	ExtensionPanelContext,
	ExtensionPanelInstance,
	ExtensionPanelRegistration,
	ExtensionRepositoryDiff,
} from '@malini/extension-api';
import { createTestHost as createHost } from '@malini/extension-api/test';
import { isPrivateFile, repositoryFileTabRows } from '../src/file-tab.js';
import extension from '../src/index.js';
import { EditorView } from '@codemirror/view';
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
				assert.equal(cursorLine(tab.editor), 2);
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
				assert.equal(tab.root.getAttribute('aria-label'), 'Contents of .github/workflows/ci.yml');
				assert.match(tab.editor.state.doc.toString(), /on: push/u);
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

test('a tab shows the file its instance key names, labelled with its path, ready to edit', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.equal(tab.root.getAttribute('aria-label'), 'Contents of src/app.ts');
				assert.equal(tab.editor.state.doc.toString(), 'export const answer = 42;\n');
				assert.equal(tab.editor.contentDOM.getAttribute('role'), 'textbox');
				assert.equal(tab.editor.contentDOM.getAttribute('aria-label'), 'Edit src/app.ts');
				assert.equal(tab.editor.contentDOM.getAttribute('contenteditable'), 'true');
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
				assert.equal(cursorLine(tab.editor), 2);
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('a markdown file opens Rich, and a line asked for opens it Raw', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-markdown',
				files: { 'NOTES.md': '# Notes\n\nFirst\n', 'GUIDE.md': '# Guide\n\nOne\nTwo\n' },
			},
		});
		try {
			await host.activate(extension);
			const notes = await mountFileTab(host, window, 'NOTES.md');
			try {
				assert.equal(pressedView(notes.root), 'Rich');
				assert.equal(notes.root.querySelector('h1')?.textContent, 'Notes');
				assert.notEqual(notes.editor.dom.closest('[hidden]'), null);
			} finally {
				await notes.instance.dispose();
			}

			const guide = await mountFileTab(host, window, 'GUIDE.md', 4);
			try {
				assert.equal(pressedView(guide.root), 'Raw');
				assert.equal(guide.editor.dom.closest('[hidden]'), null);
				assert.equal(cursorLine(guide.editor), 4);
			} finally {
				await guide.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('a markdown tab opens again in the view it was left in, and other files have no views', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const readme = await mountFileTab(host, window, 'README.md', null, false);
			viewButton(readme.root, 'Raw').click();
			await readme.instance.dispose();

			const again = await mountFileTab(host, window, 'README.md', null, false);
			try {
				assert.equal(pressedView(again.root), 'Raw');
				assert.equal(again.editor.dom.closest('[hidden]'), null);
			} finally {
				await again.instance.dispose();
			}

			const app = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.equal(app.root.querySelector('[role="group"]'), null);
			} finally {
				await app.instance.dispose();
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

test('a file changed on the branch shows its lines in place with the changed words marked, even once committed', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: {
				name: 'file-tab-changes',
				files: { 'src/app.ts': 'const a = 1;\nconst b = 3;\nconst c = 3;\n' },
			},
			repository: {
				status: { dirtyPaths: [] },
				diffs: [replacement('src/app.ts', 2, 'const b = 2;', 'const b = 3;')],
				uncommittedDiffs: [],
			},
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.deepEqual(rowTexts(tab.editor), [
					'const a = 1;',
					'Removed: const b = 2;',
					'Added: const b = 3;',
					'const c = 3;',
					'',
				]);
				assert.deepEqual(lineNumbers(tab.editor), ['1', '2', '2', '3', '4']);
				const marked = (tag: string): string[] =>
					[...tab.editor.contentDOM.querySelectorAll(tag)].map((word) => word.textContent ?? '');
				assert.deepEqual(marked('del'), ['2']);
				assert.deepEqual(marked('ins'), ['3']);
				assert.equal(tab.editor.state.doc.toString(), 'const a = 1;\nconst b = 3;\nconst c = 3;\n');
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
		const repository = followableRepository();
		const host = await createHost({
			manifest,
			fixtureRepository: { name: 'file-tab-follow', files: { 'src/app.ts': 'const b = 2;\n' } },
			repository,
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				assert.deepEqual(rowTexts(tab.editor), ['const b = 2;', '']);

				await changeOnDisk(host, repository, 'const b = 2;', 'const b = 3;');

				await eventually(() => (rowTexts(tab.editor).length === 3 ? true : null));
				assert.deepEqual(rowTexts(tab.editor), [
					'Removed: const b = 2;',
					'Added: const b = 3;',
					'',
				]);
				assert.deepEqual(savedFiles(host), [{ path: 'src/app.ts', contents: 'const b = 3;\n' }]);
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('what the user types saves itself once they pause and pins the tab, with nothing to press or read', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			try {
				type(tab.editor, 'export const answer = 42;'.length, ' // checked');

				await eventually(() => (savedFiles(host).length > 0 ? true : null));
				assert.deepEqual(savedFiles(host), [
					{ path: 'src/app.ts', contents: 'export const answer = 42; // checked\n' },
				]);
				assert.equal(
					await host.api.workstream.readFile('src/app.ts'),
					'export const answer = 42; // checked\n',
				);
				assert.equal(tab.problem.hidden, true);
				assert.deepEqual(openedTabs(host).at(-1), {
					panelId: FILE_PANEL_ID,
					label: 'app.ts',
					icon: 'path:src/app.ts',
					tooltip: 'src/app.ts',
					pinned: true,
				});
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('closing a tab saves what was typed, and a change on disk never overwrites unsaved typing', async () => {
	await withDom(async (window) => {
		const repository = followableRepository();
		const host = await createHost({
			manifest,
			fixtureRepository: { name: 'file-tab-unsaved', files: { 'src/app.ts': 'const b = 2;\n' } },
			repository,
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			type(tab.editor, 0, '// mine\n');

			await changeOnDisk(host, repository, 'const b = 2;', 'const b = 3;');
			await settle();
			assert.equal(tab.editor.state.doc.toString(), '// mine\nconst b = 2;\n');

			await tab.instance.dispose();
			assert.equal(await host.api.workstream.readFile('src/app.ts'), '// mine\nconst b = 2;\n');
		} finally {
			await host.cleanup();
		}
	});
});

test('a save that fails says why in the tab, and tells the user when the tab is closing', async () => {
	await withDom(async (window) => {
		const host = await hostWithRepository();
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'src/app.ts');
			await chmod(join(host.workstream.path, 'src/app.ts'), 0o444);
			type(tab.editor, 0, '// mine\n');

			await tab.instance.dispose();

			assert.equal(tab.problem.hidden, false);
			assert.match(tab.problem.textContent ?? '', /^Could not save app\.ts: /u);
			assert.deepEqual(
				host.snapshot().notifications.map(({ title, level }) => ({ title, level })),
				[{ title: 'Could not save app.ts', level: 'error' }],
			);
		} finally {
			await host.cleanup();
		}
	});
});

test('a file an agent opened outside the worktree opens pinned, with no tree to look it up in', async () => {
	const host = await hostWithRepository();
	try {
		await host.activate(extension);

		await host.invokeCommand('malini.repository.open-file', {
			path: '/Users/someone/.secrets/malini.keys',
			line: null,
			pinned: true,
		});

		assert.deepEqual(openedTabs(host), [
			{
				panelId: 'malini.repository.file:/Users/someone/.secrets/malini.keys',
				label: 'malini.keys',
				icon: 'path:/Users/someone/.secrets/malini.keys',
				tooltip: '/Users/someone/.secrets/malini.keys',
				pinned: true,
			},
		]);
		assert.equal(await selectedPath(host), null);
	} finally {
		await host.cleanup();
	}
});

test('a private file hides behind a notice while personal data is masked, until the user shows it', async () => {
	await withDom(async (window) => {
		const host = await createHost({
			manifest,
			fixtureRepository: { name: 'file-tab-private', files: { 'deploy.pem': 'KEY\n' } },
		});
		try {
			await host.activate(extension);
			const tab = await mountFileTab(host, window, 'deploy.pem', null, true, true);
			try {
				const show = tab.root.querySelector<HTMLButtonElement>('button');
				assert.ok(show);
				assert.equal(show.textContent, 'Show deploy.pem');
				assert.equal(show.closest('[hidden]'), null);
				assert.equal(tab.root.hasAttribute('data-masked'), true);

				show.click();

				assert.equal(tab.root.hasAttribute('data-masked'), false);
				assert.notEqual(show.closest('[hidden]'), null);
			} finally {
				await tab.instance.dispose();
			}
		} finally {
			await host.cleanup();
		}
	});
});

test('only files that hold secrets, or live outside the worktree, count as private', () => {
	const privatePaths = [
		'.env',
		'.env.local',
		'apps/web/.env.production',
		'prod.env',
		'.envrc',
		'certs/deploy.pem',
		'id.key',
		'config/.secrets/token.txt',
		'/Users/someone/.secrets/malini.keys',
		'/etc/hosts',
	];
	const publicPaths = ['src/env.ts', 'README.md', 'environment.yml', '.envoy/config', 'keys.ts'];

	assert.deepEqual(
		privatePaths.filter((path) => !isPrivateFile(path)),
		[],
	);
	assert.deepEqual(
		publicPaths.filter((path) => isPrivateFile(path)),
		[],
	);
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

type FollowableRepository = { status: { dirtyPaths: string[] }; diffs: ExtensionRepositoryDiff[] };

function followableRepository(): FollowableRepository {
	return { status: { dirtyPaths: [] }, diffs: [] };
}

async function changeOnDisk(
	host: Awaited<ReturnType<typeof createHost>>,
	repository: FollowableRepository,
	before: string,
	after: string,
): Promise<void> {
	await host.api.workstream.writeFile('src/app.ts', `${after}\n`);
	repository.status.dirtyPaths = ['src/app.ts'];
	repository.diffs = [replacement('src/app.ts', 1, before, after)];
	await host.invokeCommand('malini.repository.refresh');
}

function type(editor: EditorView, at: number, text: string): void {
	editor.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type' });
}

function cursorLine(editor: EditorView): number {
	return editor.state.doc.lineAt(editor.state.selection.main.head).number;
}

function viewButton(root: HTMLElement, name: string): HTMLButtonElement {
	const button = [...root.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
		(candidate) => candidate.textContent === name,
	);
	assert.ok(button, `the tab offers the ${name} view`);
	return button;
}

function pressedView(root: HTMLElement): string | null {
	return root.querySelector('[role="group"] [aria-pressed="true"]')?.textContent ?? null;
}

function rowTexts(editor: EditorView): readonly string[] {
	return [...editor.contentDOM.children].map((row) => row.textContent ?? '');
}

function lineNumbers(editor: EditorView): readonly string[] {
	return [...editor.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')]
		.filter((element) => element.style.visibility !== 'hidden')
		.map((element) => element.textContent ?? '');
}

function savedFiles(
	host: Awaited<ReturnType<typeof createHost>>,
): readonly Readonly<{ path?: string; contents?: string }>[] {
	return host
		.recording()
		.filter((entry) => entry.kind === 'workstream.writeFile')
		.map((entry) => entry.payload as { path?: string; contents?: string })
		.filter(({ path }) => path === 'src/app.ts');
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

async function eventually<T>(read: () => T | null): Promise<T> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const value = read();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('The tab never got there');
}

async function mountFileTab(
	host: Awaited<ReturnType<typeof createHost>>,
	window: DOMWindow,
	path: string,
	line: number | null = null,
	opened = true,
	maskPrivateData = false,
): Promise<{
	instance: ExtensionPanelInstance;
	root: HTMLElement;
	editor: EditorView;
	problem: HTMLElement;
}> {
	if (opened) await host.invokeCommand('malini.repository.open-file', { path, line });
	const panel = registeredPanel(host, FILE_TEMPLATE_ID);
	const target = window.document.createElement('div');
	window.document.body.append(target);
	const instance = await panel.component.mount(target, fileTabContext(path, maskPrivateData));
	const root = target.querySelector<HTMLElement>('.repository-file-tab');
	const editorElement = target.querySelector<HTMLElement>('.cm-editor');
	const editor = editorElement ? EditorView.findFromDOM(editorElement) : null;
	const problem = target.querySelector<HTMLElement>('[role="alert"]');
	assert.ok(root && editor && problem, `${path} opened in an editor`);
	return { instance, root, editor, problem };
}

function fileTabContext(instanceKey: string, maskPrivateData = false): ExtensionPanelContext {
	return {
		workstream: null,
		settings: {},
		instanceKey,
		maskPrivateData,
		executeCommand: async () => {
			throw new Error('The file tab tests do not execute commands');
		},
	};
}

async function selectedPath(host: Awaited<ReturnType<typeof createHost>>): Promise<unknown> {
	const status = await host.invokeCommand<{ selectedPath?: unknown }>('malini.repository.status');
	return status.selectedPath;
}

type OpenedTab = Readonly<{ panelId?: string; label?: string; icon?: string; pinned?: boolean }>;

function openedTabs(host: Awaited<ReturnType<typeof createHost>>): readonly OpenedTab[] {
	return host
		.recording()
		.filter((entry) => entry.kind === 'panels.open')
		.map(
			(entry) =>
				entry.payload as { panelId?: string; label?: string; icon?: string; pinned?: boolean },
		);
}

function registeredPanel(
	host: Awaited<ReturnType<typeof createHost>>,
	panelId: string,
): ExtensionPanelRegistration {
	const panel = host.snapshot().panelRegistrations[panelId];
	assert.ok(panel, `panel ${panelId} is registered`);
	return panel;
}
