import type {
	ExtensionAPI,
	ExtensionModule,
	ExtensionCommandManifest,
	ExtensionDisposable,
	ExtensionPanelManifest,
	ExtensionPullRequestMergeMethod,
	ExtensionSettingManifest,
	ExtensionWorkstream,
} from '@malini/extension-api';
import { EXTENSION_EVENTS } from '@malini/extension-api';
import {
	RepositoryController,
	repositorySurfaceState,
	type PullRequestActionInput,
	type RepositoryViewState,
} from './controller.js';
import {
	isGitInternalPath,
	isRecord,
	normalizeRepositoryPath,
	repositoryFileMatches,
	type RepositoryFile,
} from './domain.js';
import { repositoryFileTabs } from './file-tab.js';
import { createRepositoryPanel } from './panel.js';
import { COMMON_TREE_ICON_IDS, decodeTreeIcons, repositoryTreeIconIds } from './tree-icons.js';
import type {
	PullRequestAutomationContext,
	PullRequestAutomationEvent,
} from './pull-request-metadata.js';

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
			const setting = requireContribution(api, 'settings', 'malini.repository.show-hidden');
			const filesPanel = requireContribution(api, 'panels', 'malini.repository.files-panel');
			const refreshCommand = requireContribution(api, 'commands', 'malini.repository.refresh');
			const refreshPullRequestCommand = requireContribution(
				api,
				'commands',
				'malini.repository.refresh-pull-request',
			);
			const preparePullRequestFixCommand = requireContribution(
				api,
				'commands',
				'malini.repository.prepare-pull-request-fix',
			);
			const pullLatestCommand = requireContribution(
				api,
				'commands',
				'malini.repository.pull-latest',
			);
			const abortOperationCommand = requireContribution(
				api,
				'commands',
				'malini.repository.abort-operation',
			);
			const markPullRequestReadyCommand = requireContribution(
				api,
				'commands',
				'malini.repository.mark-pull-request-ready',
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
			const commitAndPushCommand = requireContribution(
				api,
				'commands',
				'malini.repository.commit-and-push',
			);
			const pullRequestCommand = requireContribution(
				api,
				'commands',
				'malini.repository.create-or-open-pull-request',
			);
			const requestMergeConfirmationCommand = requireContribution(
				api,
				'commands',
				'malini.repository.request-merge-confirmation',
			);
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
				api.settings.register(setting),
				api.commands.register({
					...refreshCommand,
					handler: () => controller.refresh(),
				}),
				api.commands.register({
					...refreshPullRequestCommand,
					handler: () => controller.refreshPullRequest(),
				}),
				api.commands.register({
					...preparePullRequestFixCommand,
					handler: () => controller.preparePullRequestFix(),
				}),
				api.commands.register({
					...pullLatestCommand,
					handler: () => controller.pullLatest(),
				}),
				api.commands.register({
					...abortOperationCommand,
					handler: () => controller.abortOperation(),
				}),
				api.commands.register({
					...markPullRequestReadyCommand,
					handler: () => controller.markPullRequestReadyForReview(),
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
						const { files } = controller.snapshot();
						const path = await workstreamFilePath(api, files, target.path);
						if (files.some((file) => file.path === path)) await controller.selectFile(path);
						fileTabs.open({ path, line: target.line });
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
					...commitAndPushCommand,
					handler: (input) => {
						const action = parseCommitAndPushAction(input);
						return controller.commitAndPush(action.context, action.changedPaths);
					},
				}),
				api.commands.register({
					...pullRequestCommand,
					handler: (input) => controller.createOrOpenPullRequest(parsePullRequestAction(input)),
				}),
				api.commands.register({
					...requestMergeConfirmationCommand,
					handler: (input) => {
						const confirmed = parseMergeConfirmation(input);
						return confirmed
							? controller.mergePullRequest(confirmed.mergeMethod, confirmed.expectedHeadSha)
							: controller.requestMergeConfirmation();
					},
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

function parseOpenFileTarget(input: unknown): { path: string; line: number | null } {
	if (typeof input === 'string') return { path: input, line: null };
	if (typeof input !== 'object' || input === null) {
		throw new Error('Open file target must be a path or an object');
	}
	const { path, line } = input as { path?: unknown; line?: unknown };
	if (typeof path !== 'string' || path.length === 0) {
		throw new Error('Open file target must name a path');
	}
	const usable = typeof line === 'number' && Number.isInteger(line) && line > 0;
	return { path, line: usable ? line : null };
}

function requireContribution(
	api: ExtensionAPI,
	kind: 'settings',
	id: string,
): ExtensionSettingManifest;
function requireContribution(
	api: ExtensionAPI,
	kind: 'commands',
	id: string,
): ExtensionCommandManifest;
function requireContribution(api: ExtensionAPI, kind: 'panels', id: string): ExtensionPanelManifest;
function requireContribution(
	api: ExtensionAPI,
	kind: 'settings' | 'commands' | 'panels',
	id: string,
) {
	const contribution = api.manifest.contributes?.[kind]?.find((candidate) => candidate.id === id);
	if (!contribution)
		throw new Error(`Repository extension manifest is missing ${kind} contribution ${id}`);
	return contribution;
}

export default repositoryExtension;

export type {
	PullRequestActionInput,
	PullRequestRefreshStatus,
	RepositoryMergeConfirmationRequest,
	RepositoryPullRequestFixContext,
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
export type {
	AutomatedPullRequestMetadata,
	AutomatedPullRequestMetadataInput,
	DerivedCommitMessageInput,
	PullRequestAutomationContext,
	PullRequestAutomationEvent,
	PullRequestAutomationEventStatus,
} from './pull-request-metadata.js';
export {
	AUTOMATED_PULL_REQUEST_METADATA_LIMITS,
	automatedPullRequestMetadata,
	derivedCommitMessage,
	sanitizePullRequestContextValue,
} from './pull-request-metadata.js';
export {
	pullRequestBlockingChecks,
	pullRequestCheckFailed,
	pullRequestCheckPassed,
	pullRequestChecksAllowMerge,
	pullRequestHasReviewBlockers,
	pullRequestMergeReadiness,
	pullRequestReviewStatusUnavailable,
	pullRequestViewerCanMerge,
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

const MERGE_METHODS: ReadonlySet<string> = new Set(['merge', 'squash', 'rebase']);

function isMergeMethod(input: unknown): input is ExtensionPullRequestMergeMethod {
	return typeof input === 'string' && MERGE_METHODS.has(input);
}

type MergeConfirmation = Readonly<{
	mergeMethod: ExtensionPullRequestMergeMethod | undefined;
	expectedHeadSha: string;
}>;

function parseMergeConfirmation(input: unknown): MergeConfirmation | null {
	if (input === undefined || input === null) return null;
	if (!isRecord(input)) {
		throw new Error('Merge confirmation must be an object');
	}
	const value = input;
	const unsupported = Object.keys(value).find(
		(key) => key !== 'mergeMethod' && key !== 'expectedHeadSha',
	);
	if (unsupported) throw new Error(`Unsupported merge confirmation field: ${unsupported}`);
	if (typeof value.expectedHeadSha !== 'string' || !value.expectedHeadSha.trim()) {
		throw new Error('Merge confirmation must include the confirmed pull request head revision');
	}
	const mergeMethod = value.mergeMethod;
	if (mergeMethod !== undefined && !isMergeMethod(mergeMethod)) {
		throw new Error('Merge confirmation method is not a supported GitHub merge method');
	}
	return {
		mergeMethod,
		expectedHeadSha: value.expectedHeadSha.trim(),
	};
}

function parsePullRequestAction(input: unknown): PullRequestActionInput {
	if (input === undefined) return {};
	if (!isRecord(input)) {
		throw new Error('Pull request action input must be an object');
	}
	const value = input;
	const unsupported = Object.keys(value).filter(
		(key) => key !== 'draft' && key !== 'context' && key !== 'changedPaths',
	);
	if (unsupported.length > 0) {
		throw new Error(
			`Pull request metadata is generated automatically; unsupported field: ${unsupported[0]}`,
		);
	}
	if (value.draft !== undefined && typeof value.draft !== 'boolean') {
		throw new Error('Pull request draft must be a boolean');
	}
	return {
		...(typeof value.draft === 'boolean' ? { draft: value.draft } : {}),
		...(value.context === undefined ? {} : { context: parseAutomationContext(value.context) }),
		...(value.changedPaths === undefined
			? {}
			: { changedPaths: optionalStringArray(value.changedPaths, 'changedPaths') ?? [] }),
	};
}

function parseCommitAndPushAction(input: unknown): PullRequestActionInput {
	const action = parsePullRequestAction(input);
	if (action.draft !== undefined) {
		throw new Error('Commit and push does not create a pull request; `draft` is not supported');
	}
	return action;
}

function parseAutomationContext(input: unknown): PullRequestAutomationContext {
	if (!isRecord(input)) {
		throw new Error('Pull request automation context must be an object');
	}
	const value = input;
	const allowed = new Set([
		'sessionTitle',
		'lastUserIntent',
		'runSummaries',
		'latestRunId',
		'pullRequestTitle',
		'events',
	]);
	const unsupported = Object.keys(value).find((key) => !allowed.has(key));
	if (unsupported)
		throw new Error(`Unsupported pull request automation context field: ${unsupported}`);
	const sessionTitle = optionalBoundedString(value.sessionTitle, 'sessionTitle');
	const lastUserIntent = optionalBoundedString(value.lastUserIntent, 'lastUserIntent');
	const runSummaries = optionalStringArray(value.runSummaries, 'runSummaries');
	const latestRunId = optionalBoundedString(value.latestRunId, 'latestRunId');
	const pullRequestTitle = optionalBoundedString(value.pullRequestTitle, 'pullRequestTitle');
	const events = optionalEventArray(value.events);
	return {
		...(sessionTitle === undefined ? {} : { sessionTitle }),
		...(lastUserIntent === undefined ? {} : { lastUserIntent }),
		...(runSummaries === undefined ? {} : { runSummaries }),
		...(latestRunId === undefined ? {} : { latestRunId }),
		...(pullRequestTitle === undefined ? {} : { pullRequestTitle }),
		...(events === undefined ? {} : { events }),
	};
}

export const AUTOMATION_INPUT_STRING_LIMIT = 4_000;
const AUTOMATION_INPUT_ARRAY_LIMIT = 32;

const AUTOMATION_EVENT_STATUSES: ReadonlySet<string> = new Set([
	'passed',
	'failed',
	'pending',
	'completed',
	'unknown',
]);

function isAutomationEventStatus(
	input: unknown,
): input is NonNullable<PullRequestAutomationEvent['status']> {
	return typeof input === 'string' && AUTOMATION_EVENT_STATUSES.has(input);
}

function optionalBoundedString(input: unknown, field: string): string | undefined {
	if (input === undefined) return undefined;
	if (typeof input !== 'string')
		throw new Error(`Pull request automation ${field} must be a string`);
	if (Array.from(input).length > AUTOMATION_INPUT_STRING_LIMIT) {
		throw new Error(
			`Pull request automation ${field} exceeds ${AUTOMATION_INPUT_STRING_LIMIT} characters`,
		);
	}
	return input;
}

function optionalStringArray(input: unknown, field: string): readonly string[] | undefined {
	if (input === undefined) return undefined;
	if (!Array.isArray(input)) throw new Error(`Pull request automation ${field} must be an array`);
	if (input.length > AUTOMATION_INPUT_ARRAY_LIMIT) {
		throw new Error(
			`Pull request automation ${field} supports at most ${AUTOMATION_INPUT_ARRAY_LIMIT} items`,
		);
	}
	return input.map((item, index) => optionalBoundedString(item, `${field}[${index}]`) as string);
}

function optionalEventArray(input: unknown): readonly PullRequestAutomationEvent[] | undefined {
	if (input === undefined) return undefined;
	if (!Array.isArray(input)) throw new Error('Pull request automation events must be an array');
	if (input.length > AUTOMATION_INPUT_ARRAY_LIMIT) {
		throw new Error(
			`Pull request automation events supports at most ${AUTOMATION_INPUT_ARRAY_LIMIT} items`,
		);
	}
	return input.map((event, index) => parseAutomationEvent(event, index));
}

function parseAutomationEvent(input: unknown, index: number): PullRequestAutomationEvent {
	if (!isRecord(input)) {
		throw new Error(`Pull request automation events[${index}] must be an object`);
	}
	const value = input;
	const allowed = new Set(['kind', 'label', 'status', 'detail']);
	const unsupported = Object.keys(value).find((key) => !allowed.has(key));
	if (unsupported) {
		throw new Error(`Unsupported pull request automation event field: ${unsupported}`);
	}
	if (value.kind !== 'terminal' && value.kind !== 'validation') {
		throw new Error(`Pull request automation events[${index}].kind is invalid`);
	}
	const label = optionalBoundedString(value.label, `events[${index}].label`);
	if (!label?.trim()) throw new Error(`Pull request automation events[${index}].label is required`);
	if (value.status !== undefined && !AUTOMATION_EVENT_STATUSES.has(String(value.status))) {
		throw new Error(`Pull request automation events[${index}].status is invalid`);
	}
	const detail = optionalBoundedString(value.detail, `events[${index}].detail`);
	const status = isAutomationEventStatus(value.status) ? value.status : undefined;
	return {
		kind: value.kind,
		label,
		...(status ? { status } : {}),
		...(detail === undefined ? {} : { detail }),
	};
}

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
