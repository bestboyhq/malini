import type {
	ExtensionAPI,
	ExtensionModule,
	ExtensionCommandManifest,
	ExtensionDisposable,
	ExtensionPanelManifest,
	ExtensionWorkstream,
} from '@malini/extension-api';
import { EXTENSION_EVENTS } from '@malini/extension-api';
import {
	RepositoryController,
	repositorySurfaceState,
	type RepositoryViewState,
} from './controller.js';
import {
	isGitInternalPath,
	isRecord,
	normalizeRepositoryPath,
	repositoryFileMatches,
	type RepositoryFile,
} from './domain.js';
import { repositoryFileTabs, type RepositoryFileTabTarget } from './file-tab.js';
import { createRepositoryPanel } from './panel.js';
import { COMMON_TREE_ICON_IDS, decodeTreeIcons, repositoryTreeIconIds } from './tree-icons.js';

let owned: ExtensionDisposable[] = [];

export const REPOSITORY_STATE_CHANGED_EVENT = 'malini.repository.state.changed';

const repositoryExtension: ExtensionModule = {
	async activate(api) {
		const nextOwned: ExtensionDisposable[] = [];
		void decodeTreeIcons(COMMON_TREE_ICON_IDS);
		const controller = new RepositoryController(api, {
			prepareTree: (paths) => decodeTreeIcons(repositoryTreeIconIds(paths)),
		});
		const fileTabs = repositoryFileTabs(api, controller);
		nextOwned.push({ dispose: () => fileTabs.dispose() }, { dispose: () => controller.dispose() });

		try {
			const filesPanel = requireContribution(api, 'panels', 'malini.repository.files-panel');
			const refreshCommand = requireContribution(api, 'commands', 'malini.repository.refresh');
			const refreshPullRequestCommand = requireContribution(
				api,
				'commands',
				'malini.repository.refresh-pull-request',
			);
			const abortOperationCommand = requireContribution(
				api,
				'commands',
				'malini.repository.abort-operation',
			);
			const selectCommand = requireContribution(api, 'commands', 'malini.repository.select-file');
			const openFileCommand = requireContribution(api, 'commands', 'malini.repository.open-file');
			const diffCommand = requireContribution(api, 'commands', 'malini.repository.render-diff');
			const agentSessionDiffCommand = requireContribution(
				api,
				'commands',
				'malini.repository.open-agent-session-diff',
			);
			const statusCommand = requireContribution(api, 'commands', 'malini.repository.status');
			const todosCommand = requireContribution(api, 'commands', 'malini.repository.todos');
			const addTodoCommand = requireContribution(api, 'commands', 'malini.repository.todo-add');
			const toggleTodoCommand = requireContribution(
				api,
				'commands',
				'malini.repository.todo-toggle',
			);
			const removeTodoCommand = requireContribution(
				api,
				'commands',
				'malini.repository.todo-remove',
			);
			const warmWorkstreamCommand = requireContribution(
				api,
				'commands',
				'malini.repository.warm-workstream',
			);
			nextOwned.push(
				controller.subscribe((state) => {
					void api.events
						.emit(REPOSITORY_STATE_CHANGED_EVENT, repositorySurfaceState(state))
						.catch(() => undefined);
				}),
				api.commands.register({
					...refreshCommand,
					handler: () => controller.refresh(),
				}),
				api.commands.register({
					...refreshPullRequestCommand,
					handler: () => controller.refreshPullRequest(),
				}),
				api.commands.register({
					...abortOperationCommand,
					handler: () => controller.abortOperation(),
				}),
				api.commands.register({
					...selectCommand,
					handler: (path) => {
						if (typeof path !== 'string') throw new Error('File path must be a string');
						return controller.selectFile(path);
					},
				}),
				api.commands.register({
					...openFileCommand,
					handler: async (input) => {
						const target = parseOpenFileTarget(input);
						if (target.path.startsWith('/')) {
							fileTabs.open(target);
							return;
						}
						const { files } = controller.snapshot();
						const path = await workstreamFilePath(api, files, target.path);
						if (files.some((file) => file.path === path)) await controller.selectFile(path);
						fileTabs.open({ ...target, path });
					},
				}),
				api.commands.register({
					...diffCommand,
					handler: (path) => {
						if (path !== undefined && typeof path !== 'string') {
							throw new Error('Diff path must be a string when provided');
						}
						return controller.loadDiff(path);
					},
				}),
				api.commands.register({
					...agentSessionDiffCommand,
					handler: (input) => controller.openAgentSessionDiff(input),
				}),
				api.commands.register({
					...statusCommand,
					handler: () => controller.snapshot(),
				}),
				api.commands.register({
					...todosCommand,
					handler: () => controller.todosForPrompt(),
				}),
				api.commands.register({
					...addTodoCommand,
					handler: (text) => controller.addTodo(text),
				}),
				api.commands.register({
					...toggleTodoCommand,
					handler: (input) => {
						if (!isRecord(input)) {
							throw new Error('Todo update must include an id and completion value');
						}
						return controller.setTodoCompleted(input.id, input.completed);
					},
				}),
				api.commands.register({
					...removeTodoCommand,
					handler: (id) => controller.removeTodo(id),
				}),
				api.commands.register({
					...warmWorkstreamCommand,
					handler: (input) =>
						controller.warmWorkstreams([parseWorkstreamTarget(input)], (state) =>
							publishSurface(api, state),
						),
				}),
				api.events.on('malini.workstream.changed', async (payload) => {
					const state = controller.setWorkstream(workstreamFromChange(payload));
					if (state.context && api.workstream.current()?.id === state.context.workstreamId) {
						await controller.loadTodos();
					}
				}),
				api.events.on('malini.repository.context.changed', async (context) => {
					const state = controller.setRepositoryContext(context);
					if (state.context && api.workstream.current()?.id === state.context.workstreamId) {
						await controller.loadTodos();
					}
				}),
				api.events.on(EXTENSION_EVENTS.workstreamArchived, (payload) => {
					forgetWorkstream(controller, payload);
				}),
				api.events.on(EXTENSION_EVENTS.workstreamDeleted, (payload) => {
					forgetWorkstream(controller, payload);
				}),
				api.events.on(EXTENSION_EVENTS.repositoryRefreshRequested, async (payload) => {
					const request = parseRepositoryRefreshRequest(payload);
					if (!request) return;
					const workstream = api.workstream.current();
					if (!workstream || (request.workstreamId && request.workstreamId !== workstream.id))
						return;
					if (request.scope === 'local') {
						await controller.refreshLocal();
						return;
					}
					if (request.scope === 'pull-request') {
						await controller.refreshPullRequest();
						return;
					}
					await controller.refresh();
				}),
				api.panels.register({
					...filesPanel,
					component: createRepositoryPanel(api, controller, 'files'),
				}),
			);

			await Promise.all([controller.refreshLocalFirst(), controller.loadTodos()]);
			owned = nextOwned;
			void warmOtherWorkstreams(api, controller);
		} catch (error) {
			for (const disposable of nextOwned.splice(0).reverse()) await disposable.dispose();
			throw error;
		}
	},
	async deactivate() {
		for (const disposable of owned.splice(0).reverse()) await disposable.dispose();
	},
};

async function workstreamFilePath(
	api: ExtensionAPI,
	files: readonly RepositoryFile[],
	requested: string,
): Promise<string> {
	const path = normalizeRepositoryPath(requested);
	const matches = repositoryFileMatches(files, path);
	const [only, ...others] = matches;
	if (only !== undefined && others.length === 0) return only;
	if (only !== undefined) {
		throw new Error(`${requested} matches ${matches.length} files: ${matches.join(', ')}`);
	}
	if (!isGitInternalPath(path) && (await api.workstream.stat(path))?.kind === 'file') return path;
	throw new Error(`No file in this workstream matches ${requested}`);
}

function parseOpenFileTarget(input: unknown): RepositoryFileTabTarget {
	if (typeof input === 'string') return { path: input, line: null, pinned: false };
	if (typeof input !== 'object' || input === null) {
		throw new Error('Open file target must be a path or an object');
	}
	const { path, line, pinned } = input as { path?: unknown; line?: unknown; pinned?: unknown };
	if (typeof path !== 'string' || path.length === 0) {
		throw new Error('Open file target must name a path');
	}
	const usable = typeof line === 'number' && Number.isInteger(line) && line > 0;
	return { path, line: usable ? line : null, pinned: pinned === true };
}

function requireContribution(
	api: ExtensionAPI,
	kind: 'commands',
	id: string,
): ExtensionCommandManifest;
function requireContribution(api: ExtensionAPI, kind: 'panels', id: string): ExtensionPanelManifest;
function requireContribution(api: ExtensionAPI, kind: 'commands' | 'panels', id: string) {
	const contribution = api.manifest.contributes?.[kind]?.find((candidate) => candidate.id === id);
	if (!contribution)
		throw new Error(`Repository extension manifest is missing ${kind} contribution ${id}`);
	return contribution;
}

export default repositoryExtension;

export type {
	PullRequestRefreshStatus,
	RepositorySurfaceState,
	RepositoryTodosSnapshot,
	RepositoryTodoStatus,
	RepositoryViewState,
} from './controller.js';
export { repositorySurfaceState } from './controller.js';
export type {
	RepositoryGithubAvailability,
	RepositoryGithubCheckRow,
	RepositoryGithubStatus,
	RepositoryGithubStatusNote,
	RepositoryGithubStatusTone,
} from './github-status.js';
export {
	pullRequestCheckDurationLabel,
	pullRequestChecksHeadline,
	repositoryGithubStatus,
} from './github-status.js';
export {
	pullRequestCheckFailed,
	pullRequestCheckPassed,
	pullRequestHasReviewBlockers,
	pullRequestMergeReadiness,
	pullRequestReviewStatusUnavailable,
	selectPullRequestMergeMethod,
} from './domain.js';
export type { UpstreamPosition } from './upstream-position.js';
export {
	unpulledCommits,
	unpushedCommits,
	upstreamPositionGlyphs,
	upstreamPositionSentence,
	upstreamPositionSummary,
} from './upstream-position.js';
export type { RepositoryTodo, RepositoryTodoEnvelope } from './todos/domain.js';
export {
	REPOSITORY_TODO_LIMITS,
	REPOSITORY_TODO_STATE_KEY,
	cloneRepositoryTodos,
	parseRepositoryTodoEnvelope,
	repositoryTodoOpenCount,
	sanitizeRepositoryTodoText,
} from './todos/domain.js';

async function warmOtherWorkstreams(
	api: ExtensionAPI,
	controller: RepositoryController,
): Promise<void> {
	try {
		const workstreams = (await api.workstream.list?.()) ?? [];
		await controller.warmWorkstreams(workstreams, (state) => publishSurface(api, state));
	} catch {
		return;
	}
}

function publishSurface(api: ExtensionAPI, state: RepositoryViewState): Promise<void> {
	return api.events.emit(REPOSITORY_STATE_CHANGED_EVENT, repositorySurfaceState(state));
}

function parseWorkstreamTarget(input: unknown): ExtensionWorkstream {
	if (!isRecord(input)) throw new Error('Workstream to warm must be an object');
	const text = (field: string): string => {
		const value = input[field];
		if (typeof value !== 'string' || !value.trim()) {
			throw new Error(`Workstream to warm must name its ${field}`);
		}
		return value;
	};
	const optional = (field: string): string | undefined => {
		const value = input[field];
		return typeof value === 'string' && value.trim() ? value : undefined;
	};
	const repositoryRootPath = optional('repositoryRootPath');
	const repositoryFullName = optional('repositoryFullName');
	return {
		id: text('id'),
		path: text('path'),
		repositoryPath: text('repositoryPath'),
		...(repositoryRootPath ? { repositoryRootPath } : {}),
		...(repositoryFullName ? { repositoryFullName } : {}),
		branch: text('branch'),
		baseBranch: text('baseBranch'),
	};
}

function forgetWorkstream(controller: RepositoryController, payload: unknown): void {
	if (isRecord(payload) && typeof payload.workstreamId === 'string') {
		controller.forgetWorkstream(payload.workstreamId);
	}
}

function workstreamFromChange(payload: unknown): unknown {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
	const current = (payload as { current?: unknown }).current;
	return current ?? payload;
}

type RepositoryRefreshScope = 'full' | 'local' | 'pull-request';

type RepositoryRefreshRequest = Readonly<{
	scope: RepositoryRefreshScope;
	workstreamId?: string;
}>;

function parseRepositoryRefreshRequest(payload: unknown): RepositoryRefreshRequest | null {
	if (payload === undefined || payload === null) return { scope: 'full' };
	if (!isRecord(payload)) return null;
	const value = payload;
	if (
		value.workstreamId !== undefined &&
		(typeof value.workstreamId !== 'string' || !value.workstreamId.trim())
	) {
		return null;
	}
	const scope = value.scope ?? 'full';
	if (scope !== 'full' && scope !== 'local' && scope !== 'pull-request') return null;
	return {
		scope,
		...(typeof value.workstreamId === 'string' ? { workstreamId: value.workstreamId.trim() } : {}),
	};
}
