import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ExtensionPanelContext } from '@malini/extension-api';
import type { RepositorySurfaceState, RepositoryViewState } from '../src/controller.js';
import { repositorySurfaceState } from '../src/controller.js';
import { repositoryGithubStatus } from '../src/github-status.js';
import { createRepositoryPanel, type RepositoryPanelHost } from '../src/panel.js';
import { withDom } from './dom.js';

const AHEAD = 3;
const BEHIND = 2;

function numbersIn(text: string): readonly number[] {
	return [...text.matchAll(/\d+/g)]
		.map((match) => Number(match[0]))
		.sort((left, right) => left - right);
}

test('the Changes panel header and the top bar status report the same upstream position', async () => {
	const view = viewState();
	const projected = repositorySurfaceState(view);
	assert.deepEqual(
		{ ahead: projected.ahead, behind: projected.behind },
		{ ahead: view.context?.ahead, behind: view.context?.behind },
	);

	const { glyphs, tooltip } = await panelUpstreamRendering();
	const status = repositoryGithubStatus(surface({ ahead: AHEAD, behind: BEHIND }));
	assert.ok(status, 'the top bar status projection exists for a workstream with no pull request');
	const detail = status.changes?.label ?? '';

	assert.deepEqual(numbersIn(glyphs), [BEHIND, AHEAD], `panel glyphs were ${glyphs}`);
	assert.deepEqual(numbersIn(tooltip), [BEHIND, AHEAD], `panel tooltip was ${tooltip}`);
	assert.deepEqual(
		numbersIn(detail),
		[BEHIND, AHEAD],
		`the top bar reported "${detail}" while the panel reported "${glyphs}"`,
	);
});

test('exactly one module turns an upstream position into text', async () => {
	const entries = (await readdir('src', { recursive: true }))
		.filter((name) => name.endsWith('.ts'))
		.sort();
	const renderers: string[] = [];
	for (const name of entries) {
		const source = (await readFile(`src/${name}`, 'utf8')).replaceAll(
			/^export\s*(?:\*|\{[^}]*\})\s*from\s*'[^']*';$/gmu,
			'',
		);
		const renders =
			/[↑↓]/u.test(source) ||
			/unpushed/i.test(source) ||
			/\$\{[^}]*\b(?:ahead|behind)\b[^}]*\}/u.test(source);
		if (renders) renderers.push(name);
	}
	assert.deepEqual(renderers, ['upstream-position.ts']);
});

function surface(overrides: Partial<RepositorySurfaceState> = {}): RepositorySurfaceState {
	return {
		status: 'ready',
		workstreamId: 'workstream-1',
		branch: 'feature/review',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		changedFiles: 0,
		pullRequest: null,
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		localError: null,
		pullRequestError: null,
		error: null,
		todoStatus: 'ready',
		todoOpenCount: 0,
		todoError: null,
		...overrides,
	};
}

async function panelUpstreamRendering(): Promise<{ glyphs: string; tooltip: string }> {
	return withDom(async ({ document }) => {
		const target = document.createElement('div');
		const controller = new UpstreamPanelController(viewState());
		const instance = await createRepositoryPanel(panelApi(), controller, 'changes').mount(
			target,
			repositoryPanelContext(),
		);
		try {
			const sync = target.querySelector<HTMLElement>('.repository-panel__branch-sync');
			assert.ok(sync, 'the panel header renders an upstream position');
			return { glyphs: sync.textContent ?? '', tooltip: sync.title };
		} finally {
			await instance.dispose();
		}
	});
}

class UpstreamPanelController {
	#state: RepositoryViewState;

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
		listener(this.#state);
		return {
			dispose: () => undefined,
		};
	}

	setDiffScope(): RepositoryViewState {
		return this.#state;
	}

	closeAgentSessionDiff(): RepositoryViewState {
		return this.#state;
	}

	async selectFile(): Promise<RepositoryViewState> {
		return this.#state;
	}

	async loadDiff(): Promise<RepositoryViewState> {
		return this.#state;
	}

	async refresh(): Promise<RepositoryViewState> {
		return this.#state;
	}

	async loadTodos(): Promise<RepositoryViewState> {
		return this.#state;
	}

	async refreshPullRequest(): Promise<RepositoryViewState> {
		return this.#state;
	}
}

function panelApi(): RepositoryPanelHost {
	return {
		manifest: { id: 'malini.repository' },
		notifications: { show: async () => undefined },
		workstream: { readFile: async () => '' },
		panels: {
			register: () => {
				throw new Error('The upstream position tests do not register panels');
			},
			open: () => {
				throw new Error('The upstream position tests do not open panels');
			},
		},
	};
}

function repositoryPanelContext(): ExtensionPanelContext {
	return {
		workstream: null,
		settings: {},
		executeCommand: async () => {
			throw new Error('The upstream position tests do not execute commands');
		},
	};
}

function viewState(): RepositoryViewState {
	return {
		status: 'ready',
		context: {
			workstreamId: 'workstream-1',
			repositoryPath: '/tmp/repository',
			branch: 'feature/review',
			baseBranch: 'main',
			dirtyPaths: [],
			conflictedPaths: [],
			conflictMarkerPaths: [],
			ahead: AHEAD,
			behind: BEHIND,
			hasUpstream: true,
			mergeInProgress: false,
			operationInProgress: null,
			pullRequest: null,
		},
		files: [],
		selectedPath: null,
		selectedContents: null,
		diff: null,
		diffs: [],
		agentSessionDiff: null,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		diffScope: 'uncommitted',
		uncommitted: { diffs: [], changedFiles: 0, additions: 0, deletions: 0 },
		refreshedAt: 1,
		pullRequestRefreshStatus: 'ready',
		pullRequestRefreshedAt: 1,
		pullRequestSettledAt: 1,
		mergeConfirmationRequest: null,
		localError: null,
		pullRequestError: null,
		error: null,
		todos: [],
		todoStatus: 'ready',
		todosObservedAt: 1,
		todoError: null,
	};
}
