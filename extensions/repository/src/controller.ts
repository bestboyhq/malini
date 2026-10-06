import {
	type ExtensionAPI,
	type ExtensionPullRequestCheckDiagnostics,
	type ExtensionPullRequestContext,
	type ExtensionPullRequestMergeMethod,
	type ExtensionRepositoryDiffScope,
	type ExtensionRepositoryOperation,
	type ExtensionRepositoryStatus,
	type ExtensionPullRequestReviewFeedback,
	type ExtensionSettingScope,
	type ExtensionSettingValue,
	type ExtensionWorkstream,
	EXTENSION_EVENTS,
} from '@malini/extension-api';
import {
	contextFromRepository,
	contextFromWorkstream,
	createFileList,
	isRecord,
	parseRepositoryContext,
	pullRequestBlockingChecks,
	pullRequestCheckFailed,
	pullRequestConflictsWithBase,
	pullRequestHasReviewBlockers,
	pullRequestChecksAllowMerge,
	pullRequestMergeReadiness,
	pullRequestReviewStatusUnavailable,
	repositoryLocalSignals,
	selectPullRequestMergeMethod,
	parseRepositoryAgentSessionDiff,
	renderRepositoryDiff,
	type RepositoryAgentSessionDiff,
	type RepositoryContext,
	type RepositoryDiff,
	type RepositoryFile,
} from './domain.js';
import {
	automatedPullRequestMetadata,
	type AutomatedPullRequestMetadata,
	type PullRequestAutomationContext,
} from './pull-request-metadata.js';
import {
	REPOSITORY_TODO_LIMITS,
	cloneRepositoryTodos,
	repositoryTodoOpenCount,
	sanitizeRepositoryTodoText,
	type RepositoryTodo,
} from './todos/domain.js';
import { ReadSlots } from './read-slots.js';
import { RepositoryTodoStore } from './todos/store.js';

export type RepositoryStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export type PullRequestRefreshStatus = 'idle' | 'loading' | 'ready' | 'error';
export type RepositoryTodoStatus = 'loading' | 'ready' | 'error';

export type RepositoryTodosSnapshot = Readonly<{
	workstreamId: string;
	todos: readonly RepositoryTodo[];
}>;

export type RepositoryMergeConfirmationRequest = Readonly<{
	id: number;
	pullRequestNumber: number;
	headSha: string;
	mergeMethod: ExtensionPullRequestMergeMethod;
}>;

export type RepositoryDiffScope = ExtensionRepositoryDiffScope;

export type RepositoryChangeSlice = Readonly<{
	diffs: readonly RepositoryDiff[];
	changedFiles: number;
	additions: number;
	deletions: number;
}>;

export type RepositoryViewState = {
	status: RepositoryStatus;
	context: RepositoryContext | null;
	files: readonly RepositoryFile[];
	selectedPath: string | null;
	selectedContents: string | null;
	diff: RepositoryDiff | null;
	diffs: readonly RepositoryDiff[];
	agentSessionDiff: RepositoryAgentSessionDiff | null;
	changedFiles: number;
	additions: number;
	deletions: number;
	diffScope: RepositoryDiffScope;
	uncommitted: RepositoryChangeSlice;
	refreshedAt: number | null;
	pullRequestRefreshStatus: PullRequestRefreshStatus;
	pullRequestRefreshedAt: number | null;
	pullRequestSettledAt: number | null;
	localError: string | null;
	pullRequestError: string | null;
	error: string | null;
	todos: readonly RepositoryTodo[];
	todoStatus: RepositoryTodoStatus;
	todosObservedAt: number | null;
	todoError: string | null;
	mergeConfirmationRequest: RepositoryMergeConfirmationRequest | null;
};

export type RepositoryPullRequestFixContext = Readonly<{
	state: RepositoryViewState;
	pullRequestNumber: number;
	headSha: string;
	reviewFeedback: ExtensionPullRequestReviewFeedback | null;
	checkDiagnostics: ExtensionPullRequestCheckDiagnostics | null;
}>;

export type RepositorySurfaceState = Readonly<{
	status: RepositoryStatus;
	workstreamId: string | null;
	branch: string | null;
	baseBranch: string | null;
	dirtyPaths: readonly string[];
	conflictedPaths: readonly string[];
	conflictMarkerPaths: readonly string[];
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	mergeInProgress: boolean;
	operationInProgress: ExtensionRepositoryOperation | null;
	changedFiles: number;
	pullRequest: ExtensionPullRequestContext | null;
	pullRequestRefreshStatus: PullRequestRefreshStatus;
	pullRequestRefreshedAt: number | null;
	pullRequestSettledAt: number | null;
	localError: string | null;
	pullRequestError: string | null;
	error: string | null;
	todoStatus: RepositoryTodoStatus;
	todoOpenCount: number;
	todoError: string | null;
}>;

type StateListener = (state: RepositoryViewState) => void;

type WorkstreamOperation = Readonly<{
	generation: number;
	workstream: NonNullable<ReturnType<ExtensionAPI['workstream']['current']>>;
}>;

type PullRequestBindingRequest = Readonly<{
	revision: number;
}>;

type LocalRepositorySnapshot = Readonly<{
	paths: readonly string[];
	status: ExtensionRepositoryStatus;
	diffs: Awaited<ReturnType<ExtensionAPI['repository']['diff']>>;
	uncommittedDiffs: Awaited<ReturnType<ExtensionAPI['repository']['diff']>>;
}>;

type PullRequestMergePreflight = Readonly<{
	status: ExtensionRepositoryStatus;
	pullRequest: ExtensionPullRequestContext & { number: number; headSha: string };
	mergeMethod: ExtensionPullRequestMergeMethod;
}>;

export type RepositoryControllerOptions = Readonly<{
	prepareTree?: (paths: readonly string[]) => Promise<void>;
}>;

type InactiveLocalRead = Readonly<{
	workstream: ExtensionWorkstream;
	status: ExtensionRepositoryStatus;
	state: RepositoryViewState;
}>;

type RefreshSlices = Readonly<{
	local: boolean;
	pullRequest: boolean;
}>;

type RepositoryErrorSlice = 'local' | 'pullRequest';

const PULL_REQUEST_BINDING_STATE_KEY = 'pull-request-binding.v1';

const GENERATED_PULL_REQUEST_METADATA_STATE_KEY = 'pull-request-generated-metadata.v1';

type GeneratedPullRequestMetadata = Readonly<{
	version: 1;
	pullRequestNumber: number;
	title: string | null;
	body: string | null;
}>;

export const REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT = 8;

export const REPOSITORY_WARMUP_RETRY_MS = 5 * 60_000;

export const REPOSITORY_WARMUP_PARALLEL_READS = 3;
export const REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS = 5 * 60_000;

type PullRequestBinding = Readonly<{
	version: 1;
	repositoryPath: string;
	repositoryFullName: string | null;
	headBranch: string;
	baseBranch: string;
	pullRequestNumber: number;
}>;

class StaleWorkstreamOperationError extends Error {
	constructor() {
		super('Repository operation belongs to a workstream that is no longer active');
		this.name = 'StaleWorkstreamOperationError';
	}
}

export type PullRequestActionInput = Readonly<{
	draft?: boolean;
	context?: PullRequestAutomationContext;
	changedPaths?: readonly string[];
}>;

type RepositoryControllerWorkstreamHost = Pick<
	ExtensionAPI['workstream'],
	'current' | 'listFiles' | 'readFile'
>;

type RepositoryControllerRepositoryHost = Pick<
	ExtensionAPI['repository'],
	| 'status'
	| 'diff'
	| 'pullRequest'
	| 'createPullRequest'
	| 'markPullRequestReadyForReview'
	| 'mergePullRequest'
	| 'updatePullRequestMetadata'
	| 'pullRequestReviewFeedback'
	| 'pullRequestCheckDiagnostics'
	| 'refresh'
	| 'commit'
	| 'push'
	| 'pullLatest'
	| 'abortOperation'
	| 'baseFiles'
>;

type RepositoryControllerSettingsHost = {
	get(id: string, scope?: ExtensionSettingScope): ExtensionSettingValue;
};

export type RepositoryControllerStateHost = {
	get(key: string, scope?: ExtensionSettingScope): Promise<unknown | null>;
	set(key: string, value: unknown, scope?: ExtensionSettingScope): Promise<void>;
	delete(key: string, scope?: ExtensionSettingScope): Promise<void>;
};

export type RepositoryControllerHost = Readonly<{
	workstream: RepositoryControllerWorkstreamHost;
	repository: RepositoryControllerRepositoryHost;
	settings: RepositoryControllerSettingsHost;
	clock: Pick<ExtensionAPI['clock'], 'now'>;
	state?: RepositoryControllerStateHost;
	events?: Pick<ExtensionAPI['events'], 'emit'>;
}>;

export class RepositoryController {
	readonly #api: RepositoryControllerHost;
	readonly #todoStore: RepositoryTodoStore;
	readonly #listeners = new Set<StateListener>();
	#localRefreshSequence = 0;
	#pullRequestRefreshSequence = 0;
	#latestLocalRefresh: Promise<RepositoryViewState> | null = null;
	#latestPullRequestRefresh: Promise<RepositoryViewState> | null = null;
	#pullRequestBindingRevision = 0;
	#pullRequestBindingMutationTail: Promise<void> = Promise.resolve();
	#workstreamGeneration = 0;
	#mergeConfirmationSequence = 0;
	#todoSequence = 0;
	#todoMutationTail: Promise<void> = Promise.resolve();
	readonly #activeMutationWorkstreams = new Set<string>();
	#conflictSignal: Readonly<{ workstreamId: string | null; mergeInProgress: boolean }> = {
		workstreamId: null,
		mergeInProgress: false,
	};
	#state: RepositoryViewState;
	readonly #workstreamSnapshots = new Map<string, RepositoryViewState>();
	readonly #warming = new Map<string, object>();
	readonly #opened = new Set<string>();
	readonly #localWarmReads = new ReadSlots(REPOSITORY_WARMUP_PARALLEL_READS);
	readonly #pullRequestWarmReads = new ReadSlots(REPOSITORY_WARMUP_PARALLEL_READS);
	readonly #knownWorkstreamIds = new Set<string>();
	readonly #baseFiles = new Map<string, readonly RepositoryFile[]>();
	readonly #baseFileReads = new Set<string>();
	readonly #previewListeners = new Set<() => void>();
	readonly #unwarmable = new Map<string, Readonly<{ branch: string; at: number }>>();
	#disposed = false;

	readonly #prepareTree: (paths: readonly string[]) => Promise<void>;

	constructor(api: RepositoryControllerHost, options: RepositoryControllerOptions = {}) {
		this.#api = api;
		this.#prepareTree = options.prepareTree ?? (() => Promise.resolve());
		this.#todoStore = new RepositoryTodoStore(api.state!);
		const workstream = api.workstream.current();
		this.#state = createInitialState(workstream ? contextFromWorkstream(workstream) : null);
	}

	snapshot(): RepositoryViewState {
		return cloneState(this.#state);
	}

	workstreamState(workstream: ExtensionWorkstream): RepositoryViewState {
		if (this.#state.context?.workstreamId === workstream.id) return this.snapshot();
		const context = contextFromWorkstream(workstream);
		const restorable = this.#restorableState(context, workstream.repositoryRootPath ?? null);
		if (!restorable) void this.#loadBaseFiles(workstream);
		return cloneState(restorable ?? createInitialState(context));
	}

	subscribeWorkstreamPreviews(listener: () => void): { dispose(): void } {
		this.#previewListeners.add(listener);
		return { dispose: () => this.#previewListeners.delete(listener) };
	}

	forgetWorkstream(workstreamId: string): void {
		this.#workstreamSnapshots.delete(workstreamId);
		this.#unwarmable.delete(workstreamId);
		this.#warming.delete(workstreamId);
		this.#opened.delete(workstreamId);
	}

	async warmWorkstreams(
		workstreams: readonly ExtensionWorkstream[],
		onWarmed: (state: RepositoryViewState) => void | Promise<void>,
	): Promise<void> {
		for (const { id } of workstreams) this.#knownWorkstreamIds.add(id);
		for (const workstream of workstreams) void this.#loadBaseFiles(workstream);
		const warming: Promise<void>[] = [];
		for (const workstream of workstreams
			.filter(({ id }) => id !== this.#state.context?.workstreamId)
			.slice(0, REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT - 1)) {
			if (!this.#needsWarmup(workstream.id) || !this.#mayWarm(workstream)) continue;
			const claim = {};
			this.#warming.set(workstream.id, claim);
			warming.push(this.#warmWorkstream(workstream, claim, onWarmed));
		}
		await Promise.all(warming);
	}

	async #warmWorkstream(
		workstream: ExtensionWorkstream,
		claim: object,
		onWarmed: (state: RepositoryViewState) => void | Promise<void>,
	): Promise<void> {
		const claimed = (): boolean => this.#warming.get(workstream.id) === claim;
		try {
			const read = await this.#localWarmReads.run(() => this.#readInactiveLocal(workstream));
			if (!claimed()) return;
			if (!read) {
				this.#markUnwarmable(workstream);
				return;
			}
			if (!this.#needsWarmup(workstream.id)) return;
			this.#rememberWorkstreamState(read.state);
			const pullRequest = await this.#pullRequestWarmReads.run(() =>
				this.#readInactivePullRequestSafely(read),
			);
			if (!claimed() || this.#workstreamSnapshots.get(workstream.id) !== read.state) return;
			if (!pullRequest) {
				this.#markUnwarmable(workstream);
				return;
			}
			const now = this.#api.clock.now();
			const warmed: RepositoryViewState = {
				...read.state,
				context: read.state.context
					? { ...read.state.context, pullRequest: { ...pullRequest } }
					: null,
				pullRequestRefreshStatus: 'ready',
				pullRequestSettledAt: now,
				pullRequestRefreshedAt: now,
			};
			this.#rememberWorkstreamState(warmed);
			await onWarmed(cloneState(warmed));
		} finally {
			if (claimed()) this.#warming.delete(workstream.id);
		}
	}

	subscribe(
		listener: StateListener,
		options: Readonly<{ emitCurrent?: boolean }> = {},
	): { dispose(): void } {
		this.#listeners.add(listener);
		if (options.emitCurrent !== false) listener(this.snapshot());
		return { dispose: () => this.#listeners.delete(listener) };
	}

	async refresh(): Promise<RepositoryViewState> {
		return this.#refreshSlices({ local: true, pullRequest: true });
	}

	async refreshLocalFirst(): Promise<RepositoryViewState> {
		let localSettled!: () => void;
		const local = new Promise<void>((resolve) => {
			localSettled = resolve;
		});
		const refreshed = this.#refreshSlices({ local: true, pullRequest: true }, localSettled);
		void settled(refreshed);
		await Promise.race([local, refreshed]);
		return this.snapshot();
	}

	async refreshLocal(): Promise<RepositoryViewState> {
		return this.#refreshSlices({ local: true, pullRequest: false });
	}

	async refreshPullRequest(): Promise<RepositoryViewState> {
		return this.#refreshSlices({ local: false, pullRequest: true });
	}

	async loadTodos(): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		this.#publish({
			...this.#state,
			todoStatus: 'loading',
			todoError: null,
		});
		try {
			const todos = await this.#todoStore.load(operation.workstream.id);
			this.#assertCurrentWorkstreamOperation(operation);
			this.#publish({
				...this.#state,
				todos: cloneRepositoryTodos(todos),
				todoStatus: 'ready',
				todosObservedAt: this.#api.clock.now(),
				todoError: null,
			});
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return this.snapshot();
			}
			this.#publish({
				...this.#state,
				todos: [],
				todoStatus: 'error',
				todosObservedAt: null,
				todoError: errorMessage(error),
			});
		}
		return this.snapshot();
	}

	async addTodo(input: unknown): Promise<RepositoryViewState> {
		const text = sanitizeRepositoryTodoText(input);
		return this.#mutateTodos((todos) => {
			if (todos.length >= REPOSITORY_TODO_LIMITS.maxItems) {
				throw new Error(`Workstream todos are limited to ${REPOSITORY_TODO_LIMITS.maxItems}`);
			}
			return [
				...todos,
				{
					id: this.#nextTodoId(todos),
					text,
					completed: false,
					createdAt: this.#api.clock.now(),
				},
			];
		});
	}

	async setTodoCompleted(id: unknown, completed: unknown): Promise<RepositoryViewState> {
		if (typeof id !== 'string' || !id) throw new Error('Todo id must be a string');
		if (typeof completed !== 'boolean') throw new Error('Todo completion must be a boolean');
		return this.#mutateTodos((todos) => {
			let found = false;
			const next = todos.map((todo) => {
				if (todo.id !== id) return todo;
				found = true;
				return { ...todo, completed };
			});
			if (!found) throw new Error('Todo is no longer present in this workstream');
			return next;
		});
	}

	async removeTodo(id: unknown): Promise<RepositoryViewState> {
		if (typeof id !== 'string' || !id) throw new Error('Todo id must be a string');
		return this.#mutateTodos((todos) => {
			const next = todos.filter((todo) => todo.id !== id);
			if (next.length === todos.length) {
				throw new Error('Todo is no longer present in this workstream');
			}
			return next;
		});
	}

	async resetTodos(): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		const previous = this.#todoMutationTail;
		const queued = (async () => {
			await previous;
			this.#assertCurrentWorkstreamOperation(operation);
			try {
				const todos = await this.#todoStore.reset(operation.workstream.id);
				this.#assertCurrentWorkstreamOperation(operation);
				this.#publish({
					...this.#state,
					todos: cloneRepositoryTodos(todos),
					todoStatus: 'ready',
					todosObservedAt: this.#api.clock.now(),
					todoError: null,
				});
			} catch (error) {
				this.#assertCurrentWorkstreamOperation(operation);
				this.#publish({
					...this.#state,
					todos: [],
					todoStatus: 'error',
					todosObservedAt: null,
					todoError: `Could not reset workstream todos: ${errorMessage(error)}`,
				});
				throw error;
			}
			this.#assertCurrentWorkstreamOperation(operation);
		})();
		this.#todoMutationTail = queued.catch(() => undefined);
		try {
			await queued;
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return this.snapshot();
			}
			throw error;
		}
		return this.snapshot();
	}

	todosForPrompt(): RepositoryTodosSnapshot {
		const operation = this.#captureWorkstreamOperation();
		if (this.#state.todoStatus !== 'ready') {
			throw new Error(this.#state.todoError ?? 'Workstream todos are not ready yet');
		}
		return {
			workstreamId: operation.workstream.id,
			todos: cloneRepositoryTodos(this.#state.todos),
		};
	}

	async preparePullRequestFix(): Promise<RepositoryPullRequestFixContext | null> {
		return this.#runWorkstreamDiagnosticOperation(async (operation) => {
			this.#publish(
				withSynchronizedErrors({
					...this.#state,
					pullRequestRefreshStatus: 'loading',
					pullRequestError: null,
				}),
			);
			const pullRequest = await this.#runOperationStep(operation, 'pullRequest', () =>
				this.#fetchPullRequest(operation),
			);
			this.#publishPullRequestSnapshot(operation, pullRequest);
			const conflictsWithBase = pullRequestConflictsWithBase(pullRequest);
			if (!conflictsWithBase && !pullRequestNeedsFixDiagnostics(pullRequest)) return null;
			if (pullRequest.number === null || !pullRequest.headSha) {
				this.#throwOperationError(
					operation,
					'pullRequest',
					new Error('Pull request identity is incomplete; refresh before reading diagnostics'),
				);
			}
			const pullRequestNumber = pullRequest.number;
			const headSha = pullRequest.headSha;
			if (conflictsWithBase) {
				return {
					state: await this.#holdBaseConflicts(operation, pullRequest.baseBranch),
					pullRequestNumber,
					headSha,
					reviewFeedback: null,
					checkDiagnostics: null,
				};
			}
			const query = { number: pullRequestNumber, expectedHeadSha: headSha } as const;
			const [reviewFeedback, checkDiagnostics] = await Promise.all([
				this.#api.repository.pullRequestReviewFeedback
					? this.#runOperationStep(operation, 'pullRequest', () =>
							this.#api.repository.pullRequestReviewFeedback!(query, operation.workstream.id),
						)
					: Promise.resolve(null),
				this.#api.repository.pullRequestCheckDiagnostics
					? this.#runOperationStep(operation, 'pullRequest', () =>
							this.#api.repository.pullRequestCheckDiagnostics!(query, operation.workstream.id),
						)
					: Promise.resolve(null),
			]);
			this.#assertCurrentWorkstreamOperation(operation);
			const verified = await this.#runOperationStep(operation, 'pullRequest', () =>
				this.#fetchPullRequest(operation),
			);
			if (verified.number !== pullRequestNumber || verified.headSha !== headSha) {
				this.#throwOperationError(
					operation,
					'pullRequest',
					new Error('Pull request head changed while reading diagnostics; retry Fix errors'),
				);
			}
			this.#publishPullRequestSnapshot(operation, verified);
			return {
				state: this.snapshot(),
				pullRequestNumber,
				headSha,
				reviewFeedback,
				checkDiagnostics,
			};
		});
	}

	async #refreshSlices(
		slices: RefreshSlices,
		onLocalSettled: () => void = () => undefined,
	): Promise<RepositoryViewState> {
		const refresh = this.#refreshSlicesOnce(slices, onLocalSettled);
		if (slices.local) this.#latestLocalRefresh = refresh;
		if (slices.pullRequest) this.#latestPullRequestRefresh = refresh;
		const state = await refresh;
		const newer = [
			slices.local ? this.#latestLocalRefresh : null,
			slices.pullRequest ? this.#latestPullRequestRefresh : null,
		].filter((latest) => latest !== null && latest !== refresh);
		if (newer.length === 0) return state;
		await Promise.allSettled(newer);
		return this.snapshot();
	}

	async #refreshSlicesOnce(
		slices: RefreshSlices,
		onLocalSettled: () => void,
	): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		const localSequence = slices.local ? ++this.#localRefreshSequence : null;
		const pullRequestSequence = slices.pullRequest ? ++this.#pullRequestRefreshSequence : null;
		if (slices.local || slices.pullRequest) {
			this.#publish(
				withSynchronizedErrors({
					...this.#state,
					...(slices.local ? { status: 'loading' as const, localError: null } : {}),
					...(slices.pullRequest
						? { pullRequestRefreshStatus: 'loading' as const, pullRequestError: null }
						: {}),
				}),
			);
		}

		const localPromise: Promise<LocalRepositorySnapshot | null> =
			localSequence === null
				? Promise.resolve(null)
				: this.#loadLocalSnapshot(operation, localSequence);
		const pullRequestBindingRequest = slices.pullRequest
			? this.#beginPullRequestBindingRequest()
			: null;
		const pullRequestPromise: Promise<ExtensionPullRequestContext | null> = slices.pullRequest
			? this.#fetchPullRequest(operation, pullRequestBindingRequest!)
			: Promise.resolve(null);
		if (localSequence !== null && slices.pullRequest) {
			void this.#publishLocalSliceAhead(operation, localSequence, localPromise, onLocalSettled);
		}
		const [localResult, pullRequestResult] = await Promise.allSettled([
			localPromise,
			pullRequestPromise,
		] as const);
		if (localResult.status === 'fulfilled' && localResult.value && this.#state.files.length === 0) {
			await this.#preparePaths(localResult.value.paths);
		}

		if (!this.#isCurrentWorkstreamOperation(operation)) return this.snapshot();
		const localIsCurrent = localSequence !== null && localSequence === this.#localRefreshSequence;
		const pullRequestIsCurrent =
			pullRequestSequence !== null && pullRequestSequence === this.#pullRequestRefreshSequence;
		if (!localIsCurrent && !pullRequestIsCurrent) return this.snapshot();
		const localSnapshot =
			localIsCurrent && localResult.status === 'fulfilled' ? localResult.value : null;
		const repositoryRevisionChanged = Boolean(
			localSnapshot &&
			(localSnapshot.status.branch !== operation.workstream.branch ||
				localSnapshot.status.baseBranch !== operation.workstream.baseBranch),
		);
		let pullRequestSnapshot =
			pullRequestIsCurrent && pullRequestResult.status === 'fulfilled'
				? pullRequestResult.value
				: null;
		let pullRequestRediscoveryError: unknown = null;
		let terminalRediscoveryTriggered = false;
		const terminalCandidate =
			pullRequestSnapshot ??
			(slices.pullRequest ? null : (this.#state.context?.pullRequest ?? null));
		const terminalDiscoveryPullRequestSequence = this.#pullRequestRefreshSequence;
		if (
			localSnapshot &&
			terminalCandidate &&
			!repositoryRevisionChanged &&
			hasChangesAfterTerminalPullRequest(localSnapshot.status, terminalCandidate) &&
			isTerminalPullRequest(terminalCandidate)
		) {
			terminalRediscoveryTriggered = true;
			try {
				pullRequestSnapshot = await this.#retireTerminalPullRequestAndDiscover(
					operation,
					pullRequestBindingRequest ?? this.#beginPullRequestBindingRequest(),
				);
			} catch (error) {
				if (
					error instanceof StaleWorkstreamOperationError ||
					!this.#isCurrentWorkstreamOperation(operation)
				) {
					return this.snapshot();
				}
				pullRequestRediscoveryError = error;
				pullRequestSnapshot = null;
			}
			if (
				localSequence !== this.#localRefreshSequence ||
				(pullRequestSequence !== null
					? pullRequestSequence !== this.#pullRequestRefreshSequence
					: terminalDiscoveryPullRequestSequence !== this.#pullRequestRefreshSequence)
			) {
				return this.snapshot();
			}
		}

		let next = this.#state;
		let refreshed = false;
		if (localIsCurrent) {
			if (localSnapshot) {
				try {
					next = {
						...this.#withLocalSnapshot(next, operation.workstream, localSnapshot),
						localError: null,
					};
					if (repositoryRevisionChanged && next.context) {
						next = {
							...next,
							context: { ...next.context, pullRequest: null },
							pullRequestRefreshStatus: slices.pullRequest ? 'error' : 'idle',
							pullRequestSettledAt: slices.pullRequest
								? this.#api.clock.now()
								: next.pullRequestSettledAt,
							pullRequestRefreshedAt: null,
							pullRequestError: slices.pullRequest
								? 'The repository branch changed during refresh; retry after the workstream context updates'
								: null,
							mergeConfirmationRequest: null,
						};
					}
					refreshed = true;
				} catch (error) {
					const message = errorMessage(error);
					next = { ...next, status: 'error', localError: message };
				}
			} else if (localResult.status === 'rejected') {
				const message = errorMessage(localResult.reason);
				next = { ...next, status: 'error', localError: message };
			}
		}
		if ((pullRequestIsCurrent || terminalRediscoveryTriggered) && !repositoryRevisionChanged) {
			if (pullRequestRediscoveryError !== null) {
				const message = errorMessage(pullRequestRediscoveryError);
				next = {
					...next,
					pullRequestRefreshStatus: 'error',
					pullRequestSettledAt: this.#api.clock.now(),
					pullRequestError: message,
				};
			} else if (pullRequestSnapshot) {
				next = {
					...next,
					pullRequestRefreshStatus: 'ready',
					pullRequestSettledAt: this.#api.clock.now(),
					pullRequestRefreshedAt: this.#api.clock.now(),
					pullRequestError: null,
					context: {
						...(next.context ?? contextFromWorkstream(operation.workstream)),
						pullRequest: { ...pullRequestSnapshot },
					},
				};
				refreshed = true;
			} else if (pullRequestResult.status === 'rejected') {
				const message = errorMessage(pullRequestResult.reason);
				next = {
					...next,
					pullRequestRefreshStatus: 'error',
					pullRequestSettledAt: this.#api.clock.now(),
					pullRequestError: message,
				};
			}
		}
		if (repositoryRevisionChanged) {
			this.#localRefreshSequence += 1;
			this.#pullRequestRefreshSequence += 1;
			this.#workstreamGeneration += 1;
		}
		this.#publish(
			withSynchronizedErrors({
				...next,
				...(refreshed ? { refreshedAt: this.#api.clock.now() } : {}),
			}),
		);
		return this.snapshot();
	}

	async #publishLocalSliceAhead(
		operation: WorkstreamOperation,
		localSequence: number,
		localPromise: Promise<LocalRepositorySnapshot | null>,
		onLocalSettled: () => void,
	): Promise<void> {
		if (await this.#publishLocalSlice(operation, localSequence, localPromise)) onLocalSettled();
	}

	async #publishLocalSlice(
		operation: WorkstreamOperation,
		localSequence: number,
		localPromise: Promise<LocalRepositorySnapshot | null>,
	): Promise<boolean> {
		let snapshot: LocalRepositorySnapshot | null;
		try {
			snapshot = await localPromise;
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				localSequence !== this.#localRefreshSequence ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return false;
			}
			this.#publish(
				withSynchronizedErrors({
					...this.#state,
					status: 'error',
					localError: errorMessage(error),
				}),
			);
			return true;
		}
		if (
			!snapshot ||
			localSequence !== this.#localRefreshSequence ||
			!this.#isCurrentWorkstreamOperation(operation) ||
			snapshot.status.branch !== operation.workstream.branch ||
			snapshot.status.baseBranch !== operation.workstream.baseBranch
		) {
			return false;
		}
		if (this.#state.files.length === 0) {
			await this.#preparePaths(snapshot.paths);
			if (
				localSequence !== this.#localRefreshSequence ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return false;
			}
		}
		let next: RepositoryViewState;
		try {
			next = this.#withLocalSnapshot(this.#state, operation.workstream, snapshot);
		} catch {
			return false;
		}
		this.#publish(
			withSynchronizedErrors({
				...next,
				localError: null,
				refreshedAt: this.#api.clock.now(),
			}),
		);
		return true;
	}

	async #loadLocalSnapshot(
		operation: WorkstreamOperation,
		localSequence: number,
	): Promise<LocalRepositorySnapshot> {
		const workstreamId = operation.workstream.id;
		const refreshed = this.#api.repository.refresh(workstreamId);
		const listedPaths = this.#api.workstream.listFiles(undefined, workstreamId);
		if (this.#state.files.length === 0) {
			void this.#publishFilesAhead(operation, localSequence, listedPaths);
		}
		const [paths, status, diffs, uncommittedDiffs] = await Promise.all([
			listedPaths,
			this.#api.repository.status(workstreamId),
			this.#loadBranchDiffAfter(refreshed, operation),
			this.#api.repository.diff(undefined, workstreamId, 'uncommitted'),
		]);
		this.#assertCurrentWorkstreamOperation(operation);
		return { paths, status, diffs, uncommittedDiffs };
	}

	async #publishFilesAhead(
		operation: WorkstreamOperation,
		localSequence: number,
		listedPaths: Promise<readonly string[]>,
	): Promise<void> {
		let paths: readonly string[];
		try {
			paths = await listedPaths;
		} catch {
			return;
		}
		if (
			localSequence !== this.#localRefreshSequence ||
			!this.#isCurrentWorkstreamOperation(operation) ||
			this.#state.files.length > 0
		) {
			return;
		}
		let files: readonly RepositoryFile[];
		try {
			files = createFileList(
				paths,
				this.#api.settings.get('malini.repository.show-hidden') === true,
			);
		} catch {
			return;
		}
		if (files.length === 0) return;
		await this.#prepareFiles(files);
		if (
			localSequence !== this.#localRefreshSequence ||
			!this.#isCurrentWorkstreamOperation(operation) ||
			this.#state.files.length > 0
		) {
			return;
		}
		this.#publish({ ...this.#state, files });
	}

	#prepareFiles(files: readonly RepositoryFile[]): Promise<void> {
		return this.#preparePaths(files.map(({ path }) => path));
	}

	async #preparePaths(paths: readonly string[]): Promise<void> {
		try {
			await this.#prepareTree(paths);
		} catch {
			return;
		}
	}

	async #loadBranchDiffAfter(
		refreshed: Promise<void>,
		operation: WorkstreamOperation,
	): Promise<LocalRepositorySnapshot['diffs']> {
		await refreshed;
		this.#assertCurrentWorkstreamOperation(operation);
		return this.#api.repository.diff(undefined, operation.workstream.id, 'branch');
	}

	async #fetchPullRequest(
		operation: WorkstreamOperation,
		bindingRequest: PullRequestBindingRequest = this.#beginPullRequestBindingRequest(),
	): Promise<ExtensionPullRequestContext> {
		if (!this.#api.state) {
			const pullRequest = await this.#api.repository.pullRequest(operation.workstream.id);
			this.#assertCurrentWorkstreamOperation(operation);
			this.#assertPullRequestMatchesWorkstream(operation, pullRequest);
			return pullRequest;
		}
		const scope = pullRequestBindingScope(operation.workstream.id);
		const stored = await this.#api.state.get(PULL_REQUEST_BINDING_STATE_KEY, scope);
		this.#assertCurrentWorkstreamOperation(operation);
		const parsed = parsePullRequestBinding(stored);
		const binding =
			parsed && pullRequestBindingMatchesWorkstream(parsed, operation.workstream) ? parsed : null;
		if (stored !== null && !binding) {
			await this.#mutatePullRequestBinding(operation, bindingRequest, () =>
				this.#api.state!.delete(PULL_REQUEST_BINDING_STATE_KEY, scope),
			);
		}
		const pullRequest = await this.#api.repository.pullRequest(
			operation.workstream.id,
			binding ? { pullRequestNumber: binding.pullRequestNumber } : undefined,
		);
		this.#assertCurrentWorkstreamOperation(operation);
		await this.#reconcilePullRequestBinding(operation, pullRequest, binding, bindingRequest);
		return pullRequest;
	}

	async #fetchPullRequestForStatus(
		operation: WorkstreamOperation,
		status: ExtensionRepositoryStatus,
	): Promise<ExtensionPullRequestContext> {
		return this.#runOperationStep(operation, 'pullRequest', async () => {
			const bindingRequest = this.#beginPullRequestBindingRequest();
			const pullRequest = await this.#fetchPullRequest(operation, bindingRequest);
			if (
				!isTerminalPullRequest(pullRequest) ||
				!hasChangesAfterTerminalPullRequest(status, pullRequest)
			) {
				return pullRequest;
			}
			return this.#retireTerminalPullRequestAndDiscover(operation, bindingRequest);
		});
	}

	async #retireTerminalPullRequestAndDiscover(
		operation: WorkstreamOperation,
		bindingRequest: PullRequestBindingRequest = this.#beginPullRequestBindingRequest(),
	): Promise<ExtensionPullRequestContext> {
		if (this.#api.state) {
			await this.#mutatePullRequestBinding(operation, bindingRequest, () =>
				this.#api.state!.delete(
					PULL_REQUEST_BINDING_STATE_KEY,
					pullRequestBindingScope(operation.workstream.id),
				),
			);
		}
		const discovered = await this.#api.repository.pullRequest(operation.workstream.id);
		this.#assertCurrentWorkstreamOperation(operation);
		const pullRequest = isTerminalPullRequest(discovered)
			? notOpenPullRequest(operation.workstream)
			: discovered;
		this.#assertPullRequestMatchesWorkstream(operation, pullRequest);
		await this.#reconcilePullRequestBinding(operation, pullRequest, null, bindingRequest);
		return pullRequest;
	}

	async #reconcilePullRequestBinding(
		operation: WorkstreamOperation,
		pullRequest: ExtensionPullRequestContext,
		current: PullRequestBinding | null = null,
		bindingRequest: PullRequestBindingRequest = this.#beginPullRequestBindingRequest(),
	): Promise<void> {
		if (!this.#api.state || pullRequest.state === 'unavailable') return;
		this.#assertPullRequestMatchesWorkstream(operation, pullRequest);
		const scope = pullRequestBindingScope(operation.workstream.id);
		if (pullRequest.state === 'not_open' || !isPositivePullRequestNumber(pullRequest.number)) {
			if (current) {
				await this.#mutatePullRequestBinding(operation, bindingRequest, () =>
					this.#api.state!.delete(PULL_REQUEST_BINDING_STATE_KEY, scope),
				);
			}
			return;
		}
		const pullRequestNumber = pullRequest.number;
		await this.#mutatePullRequestBinding(operation, bindingRequest, () =>
			this.#api.state!.set(
				PULL_REQUEST_BINDING_STATE_KEY,
				pullRequestBindingFromWorkstream(operation.workstream, pullRequestNumber),
				scope,
			),
		);
	}

	#beginPullRequestBindingRequest(): PullRequestBindingRequest {
		return { revision: ++this.#pullRequestBindingRevision };
	}

	#isCurrentPullRequestBindingRequest(
		operation: WorkstreamOperation,
		request: PullRequestBindingRequest,
	): boolean {
		return (
			request.revision === this.#pullRequestBindingRevision &&
			this.#isCurrentWorkstreamOperation(operation)
		);
	}

	async #mutatePullRequestBinding(
		operation: WorkstreamOperation,
		request: PullRequestBindingRequest,
		mutation: () => Promise<void>,
	): Promise<void> {
		const previous = this.#pullRequestBindingMutationTail;
		const queued = (async () => {
			await previous;
			if (!this.#isCurrentPullRequestBindingRequest(operation, request)) return;
			await mutation();
		})();
		this.#pullRequestBindingMutationTail = queued.catch(() => undefined);
		await queued;
	}

	#assertPullRequestMatchesWorkstream(
		operation: WorkstreamOperation,
		pullRequest: ExtensionPullRequestContext,
	): void {
		if (pullRequest.state === 'not_open' || pullRequest.state === 'unavailable') return;
		if (
			pullRequest.headBranch !== operation.workstream.branch ||
			pullRequest.baseBranch !== operation.workstream.baseBranch
		) {
			throw new Error('Pull request does not match the active repository branch binding');
		}
	}

	#withLocalSnapshot(
		state: RepositoryViewState,
		workstream: ExtensionWorkstream,
		snapshot: LocalRepositorySnapshot,
	): RepositoryViewState {
		const files = createFileList(
			snapshot.paths,
			this.#api.settings.get('malini.repository.show-hidden') === true,
		);
		const diffs = snapshot.diffs.map(renderRepositoryDiff);
		const changedFiles = changedPathCount(snapshot.status.dirtyPaths, diffs);
		const selectedPath = state.agentSessionDiff
			? state.agentSessionDiff.path
			: files.some(({ path }) => path === state.selectedPath)
				? state.selectedPath
				: null;
		return {
			...state,
			status: files.length > 0 ? 'ready' : 'empty',
			context: contextFromLocalRepository(
				workstream,
				snapshot.status,
				state.context?.pullRequest ?? null,
			),
			files,
			selectedPath,
			selectedContents: state.agentSessionDiff
				? null
				: selectedPath
					? state.selectedContents
					: null,
			diff: diffs[0] ?? null,
			diffs,
			changedFiles,
			additions: diffs.reduce((total, diff) => total + diff.additions, 0),
			deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
			uncommitted: changeSlice(
				snapshot.uncommittedDiffs.map(renderRepositoryDiff),
				snapshot.status.dirtyPaths,
			),
		};
	}

	async selectFile(path: string): Promise<RepositoryViewState> {
		return this.#runWorkstreamOperation(async (operation) => {
			if (!this.#state.files.some((file) => file.path === path)) {
				throw new Error(`File is not present in the repository snapshot: ${path}`);
			}
			const contents = await this.#api.workstream.readFile(path, operation.workstream.id);
			this.#assertCurrentWorkstreamOperation(operation);
			this.#publish({
				...this.#state,
				selectedPath: path,
				selectedContents: contents,
				agentSessionDiff: null,
			});
			return this.snapshot();
		});
	}

	showFile(path: string): void {
		const state = this.#state;
		if (state.agentSessionDiff || state.selectedPath === path) return;
		if (!state.files.some((file) => file.path === path)) return;
		this.#publish({ ...state, selectedPath: path, selectedContents: null });
	}

	hideFile(path: string): void {
		const state = this.#state;
		if (state.agentSessionDiff || state.selectedPath !== path) return;
		this.#publish({ ...state, selectedPath: null, selectedContents: null });
	}

	setDiffScope(scope: RepositoryDiffScope): RepositoryViewState {
		if (this.#state.diffScope === scope) return this.snapshot();
		this.#publish({ ...this.#state, diffScope: scope, diff: null });
		return this.snapshot();
	}

	async loadDiff(path?: string): Promise<RepositoryViewState> {
		const scope = this.#state.diffScope;
		return this.#runWorkstreamOperation(async (operation) => {
			const diffs = (await this.#api.repository.diff(path, operation.workstream.id, scope)).map(
				renderRepositoryDiff,
			);
			this.#assertCurrentWorkstreamOperation(operation);
			if (path !== undefined) {
				this.#publish({
					...this.#state,
					diff: diffs[0] ?? null,
					agentSessionDiff: null,
				});
				return this.snapshot();
			}
			if (scope === 'uncommitted') {
				this.#publish({
					...this.#state,
					diff: diffs[0] ?? null,
					agentSessionDiff: null,
					uncommitted: changeSlice(diffs, this.#state.context?.dirtyPaths ?? []),
				});
				return this.snapshot();
			}
			this.#publish({
				...this.#state,
				diff: diffs[0] ?? null,
				diffs,
				agentSessionDiff: null,
				changedFiles: changedPathCount(this.#state.context?.dirtyPaths ?? [], diffs),
				additions: diffs.reduce((total, diff) => total + diff.additions, 0),
				deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
			});
			return this.snapshot();
		});
	}

	openAgentSessionDiff(input: unknown): RepositoryViewState {
		const agentSessionDiff = parseRepositoryAgentSessionDiff(input);
		this.#publish({
			...this.#state,
			selectedPath: agentSessionDiff.path,
			selectedContents: null,
			agentSessionDiff,
		});
		return this.snapshot();
	}

	closeAgentSessionDiff(): RepositoryViewState {
		this.#publish({
			...this.#state,
			selectedPath: null,
			selectedContents: null,
			diff: this.#state.diffs[0] ?? null,
			agentSessionDiff: null,
		});
		return this.snapshot();
	}

	async createOrOpenPullRequest(input: PullRequestActionInput = {}): Promise<RepositoryViewState> {
		return this.#runWorkstreamMutation(async (operation) => {
			const status = await this.#loadMutationStatus(operation);
			const existing = await this.#fetchPullRequestForStatus(operation, status);
			if (existing.state === 'open' || existing.state === 'draft') {
				if (status.dirtyPaths.length > 0 || status.ahead > 0) {
					await this.#publishChanges(operation, status, input.context, input.changedPaths);
				}
				this.#publish({
					...this.#state,
					context: contextFromRepository(
						operation.workstream,
						{
							...status,
							dirtyPaths: status.dirtyPaths.length > 0 ? [] : status.dirtyPaths,
							ahead: status.ahead > 0 ? 0 : status.ahead,
						},
						existing,
					),
					localError: null,
					pullRequestRefreshStatus: 'ready',
					pullRequestSettledAt: this.#api.clock.now(),
					pullRequestRefreshedAt: this.#api.clock.now(),
					pullRequestError: null,
					error: null,
				});
				return status.dirtyPaths.length > 0 || status.ahead > 0
					? this.refresh()
					: this.refreshPullRequest();
			}
			return this.#createPullRequest(operation, status, input);
		});
	}

	async createPullRequest(input: PullRequestActionInput = {}): Promise<RepositoryViewState> {
		return this.#runWorkstreamMutation(async (operation) => {
			const status = await this.#loadMutationStatus(operation);
			const existing = await this.#fetchPullRequestForStatus(operation, status);
			if (existing.state === 'open' || existing.state === 'draft') {
				this.#publish({
					...this.#state,
					context: contextFromRepository(operation.workstream, status, existing),
					localError: null,
					pullRequestRefreshStatus: 'ready',
					pullRequestSettledAt: this.#api.clock.now(),
					pullRequestRefreshedAt: this.#api.clock.now(),
					pullRequestError: null,
					error: null,
				});
				return this.snapshot();
			}
			return this.#createPullRequest(operation, status, input);
		});
	}

	async markPullRequestReadyForReview(): Promise<RepositoryViewState> {
		const mutation = this.#api.repository.markPullRequestReadyForReview;
		if (!mutation) return this.refreshPullRequest();
		return this.#runWorkstreamMutation(async (operation) => {
			const status = await this.#loadMutationStatus(operation);
			const pullRequest = await this.#fetchPullRequestForStatus(operation, status);
			if (pullRequest.state !== 'draft' || pullRequest.number === null) {
				this.#throwOperationError(
					operation,
					'pullRequest',
					new Error('Only a draft pull request can be marked ready for review'),
				);
			}
			const updated = await this.#runOperationStep(operation, 'pullRequest', () =>
				mutation({ number: pullRequest.number! }, operation.workstream.id),
			);
			await this.#runOperationStep(operation, 'pullRequest', () =>
				this.#reconcilePullRequestBinding(operation, updated),
			);
			return this.refresh();
		});
	}

	async requestMergeConfirmation(
		preferredMergeMethod?: ExtensionPullRequestMergeMethod,
	): Promise<RepositoryViewState> {
		return this.#runWorkstreamOperation(async (operation) => {
			this.#assertNoActiveMutation(operation.workstream.id);
			return this.#withFreshTodosForMerge(operation, async (todos) => {
				const preflight = await this.#loadMergePreflight(operation, preferredMergeMethod, todos);
				const request: RepositoryMergeConfirmationRequest = {
					id: ++this.#mergeConfirmationSequence,
					pullRequestNumber: preflight.pullRequest.number,
					headSha: preflight.pullRequest.headSha,
					mergeMethod: preflight.mergeMethod,
				};
				this.#publishMergePreflight(operation, preflight, request);
				return this.snapshot();
			});
		});
	}

	consumeMergeConfirmationRequest(id: number): void {
		if (this.#state.mergeConfirmationRequest?.id !== id) return;
		this.#state = { ...this.#state, mergeConfirmationRequest: null };
	}

	async mergePullRequest(
		preferredMergeMethod: ExtensionPullRequestMergeMethod | undefined,
		expectedHeadSha: string,
	): Promise<RepositoryViewState> {
		const mutation = this.#api.repository.mergePullRequest;
		if (!mutation) return this.refreshPullRequest();
		return this.#runWorkstreamMutation(async (operation) => {
			return this.#withFreshTodosForMerge(operation, async (todos) => {
				if (!expectedHeadSha) {
					this.#throwOperationError(
						operation,
						'pullRequest',
						new Error('Review the current pull request head before merging'),
					);
				}
				const preflight = await this.#loadMergePreflight(operation, preferredMergeMethod, todos);
				this.#publishMergePreflight(operation, preflight, null);
				if (preflight.pullRequest.headSha !== expectedHeadSha) {
					this.#throwOperationError(
						operation,
						'pullRequest',
						new Error(
							'The pull request changed after confirmation; review the latest head and retry',
						),
					);
				}
				const updated = await this.#runOperationStep(operation, 'pullRequest', () =>
					mutation(
						{
							number: preflight.pullRequest.number,
							expectedHeadSha,
							mergeMethod: preflight.mergeMethod,
						},
						operation.workstream.id,
					),
				);
				await this.#runOperationStep(operation, 'pullRequest', () =>
					this.#reconcilePullRequestBinding(operation, updated),
				);
				return this.refresh();
			});
		});
	}

	async #loadMergePreflight(
		operation: WorkstreamOperation,
		preferredMergeMethod: ExtensionPullRequestMergeMethod | undefined,
		todos: readonly RepositoryTodo[],
	): Promise<PullRequestMergePreflight> {
		const status = await this.#loadMutationStatus(operation);
		const pullRequest = await this.#fetchPullRequestForStatus(operation, status);
		if (status.dirtyPaths.length > 0 || status.ahead > 0) {
			this.#throwOperationError(
				operation,
				'local',
				new Error('Commit and push all local changes before merging'),
			);
		}
		if (pullRequest.state !== 'open' || pullRequest.number === null) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Only an open pull request can be merged'),
			);
		}
		const pullRequestNumber = pullRequest.number;
		const openTodos = repositoryTodoOpenCount(todos);
		if (openTodos > 0) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error(
					`Complete ${openTodos} open workstream todo${openTodos === 1 ? '' : 's'} before merging`,
				),
			);
		}
		if (!pullRequestChecksAllowMerge(pullRequest.checks, pullRequest.checkItems ?? [])) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Pull request checks must pass before merging'),
			);
		}
		if (pullRequestHasReviewBlockers(pullRequest)) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Resolve requested changes and review threads before merging'),
			);
		}
		if (pullRequestReviewStatusUnavailable(pullRequest)) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Pull request review thread status is unavailable; retry status before merging'),
			);
		}
		if (pullRequest.viewerCanMerge !== true) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error(
					pullRequest.viewerCanMerge === false
						? 'You do not have permission to merge this pull request'
						: 'Pull request merge permission is unavailable; retry status before merging',
				),
			);
		}
		if (
			preferredMergeMethod &&
			!(pullRequest.allowedMergeMethods ?? []).includes(preferredMergeMethod)
		) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('The selected merge method is no longer available for this repository'),
			);
		}
		const mergeMethod = selectPullRequestMergeMethod(pullRequest, preferredMergeMethod);
		if (!mergeMethod) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('This repository does not expose an available merge method'),
			);
		}
		if (!pullRequest.headSha) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Pull request head status is unavailable; retry before merging'),
			);
		}
		const headSha = pullRequest.headSha;
		const readiness = pullRequestMergeReadiness(pullRequest);
		if (readiness === 'behind') {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('Pull the latest target branch before merging'),
			);
		}
		if (readiness === 'blocked') {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('GitHub reports that this pull request is blocked from merging'),
			);
		}
		if (readiness === 'checking') {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('GitHub is still computing pull request mergeability'),
			);
		}
		return {
			status,
			pullRequest: { ...pullRequest, number: pullRequestNumber, headSha },
			mergeMethod,
		};
	}

	#publishMergePreflight(
		operation: WorkstreamOperation,
		preflight: PullRequestMergePreflight,
		request: RepositoryMergeConfirmationRequest | null,
	): void {
		this.#publish(
			withSynchronizedErrors({
				...this.#state,
				context: contextFromRepository(
					operation.workstream,
					preflight.status,
					preflight.pullRequest,
				),
				refreshedAt: this.#api.clock.now(),
				localError: null,
				pullRequestRefreshStatus: 'ready',
				pullRequestSettledAt: this.#api.clock.now(),
				pullRequestRefreshedAt: this.#api.clock.now(),
				pullRequestError: null,
				mergeConfirmationRequest: request,
			}),
		);
	}

	#publishPullRequestSnapshot(
		operation: WorkstreamOperation,
		pullRequest: ExtensionPullRequestContext,
	): void {
		this.#assertCurrentWorkstreamOperation(operation);
		this.#publish(
			withSynchronizedErrors({
				...this.#state,
				context: {
					...(this.#state.context ?? contextFromWorkstream(operation.workstream)),
					pullRequest: clonePullRequest(pullRequest),
				},
				refreshedAt: this.#api.clock.now(),
				pullRequestRefreshStatus: 'ready',
				pullRequestSettledAt: this.#api.clock.now(),
				pullRequestRefreshedAt: this.#api.clock.now(),
				pullRequestError: null,
			}),
		);
	}

	async pullLatest(): Promise<RepositoryViewState> {
		return this.#runWorkstreamMutation(async (operation) => {
			const status = await this.#loadMutationStatus(operation);
			const pullRequest = await this.#fetchPullRequestForStatus(operation, status);
			if (status.dirtyPaths.length > 0) {
				this.#throwOperationError(
					operation,
					'local',
					new Error('Commit or discard local changes before pulling the target branch'),
				);
			}
			const upstreamBehind = status.behind > 0;
			const targetBranchBehind =
				pullRequestMergeReadiness(pullRequest) === 'behind' || (pullRequest.behindBase ?? 0) > 0;
			if (!upstreamBehind && !targetBranchBehind) {
				this.#throwOperationError(
					operation,
					'local',
					new Error('This workstream branch is already up to date'),
				);
			}
			const pulled = await this.#pullHoldingConflicts(
				operation,
				upstreamBehind ? status.branch : pullRequest.baseBranch,
			);
			if (pulled === 'merged') {
				await this.#runOperationStep(operation, 'local', () =>
					this.#api.repository.push(operation.workstream.id),
				);
			}
			return this.refresh();
		});
	}

	async abortOperation(): Promise<RepositoryViewState> {
		const abort = this.#api.repository.abortOperation;
		if (!abort)
			throw new Error(
				'Aborting a merge, rebase, cherry-pick or revert is unavailable in this host',
			);
		return this.#runWorkstreamMutation(async (operation) => {
			await this.#runOperationStep(operation, 'local', () => abort(operation.workstream.id));
			return this.refresh();
		});
	}

	async #holdBaseConflicts(
		operation: WorkstreamOperation,
		baseBranch: string,
	): Promise<RepositoryViewState> {
		const workstreamId = operation.workstream.id;
		this.#assertNoActiveMutation(workstreamId);
		this.#activeMutationWorkstreams.add(workstreamId);
		try {
			const status = await this.#loadMutationStatus(operation);
			if (!status.mergeInProgress) {
				const pulled = await this.#pullHoldingConflicts(operation, baseBranch);
				if (pulled === 'merged') {
					await this.#runOperationStep(operation, 'local', () =>
						this.#api.repository.push(workstreamId),
					);
				}
			}
			return await this.refresh();
		} finally {
			this.#activeMutationWorkstreams.delete(workstreamId);
		}
	}

	async #pullHoldingConflicts(
		operation: WorkstreamOperation,
		ref: string,
	): Promise<'merged' | 'conflicted'> {
		await this.#runOperationStep(operation, 'local', () =>
			this.#api.repository.pullLatest(ref, operation.workstream.id),
		);
		const status = await this.#loadMutationStatus(operation);
		return status.mergeInProgress ? 'conflicted' : 'merged';
	}

	async commitAndPush(
		context?: PullRequestAutomationContext,
		changedPaths?: readonly string[],
	): Promise<RepositoryViewState> {
		return this.#runWorkstreamMutation(async (operation) => {
			const status = await this.#loadMutationStatus(operation);
			await this.#publishChanges(operation, status, context, changedPaths);
			return this.refresh();
		});
	}

	async #createPullRequest(
		operation: WorkstreamOperation,
		status: Awaited<ReturnType<ExtensionAPI['repository']['status']>>,
		input: PullRequestActionInput,
	): Promise<RepositoryViewState> {
		this.#assertStatusMatchesWorkstream(operation, status);
		const metadata = automatedPullRequestMetadata({
			branch: status.branch,
			baseBranch: status.baseBranch,
			changedPaths: mergedChangedPaths(status.dirtyPaths, input.changedPaths),
			...(input.context ? { context: input.context } : {}),
		});
		if (status.dirtyPaths.length > 0) {
			await this.#runOperationStep(operation, 'local', () =>
				this.#api.repository.commit(
					metadata.commitMessage,
					operation.workstream.id,
					metadata.commitRun ?? undefined,
				),
			);
		}
		await this.#runOperationStep(operation, 'local', () =>
			this.#api.repository.push(operation.workstream.id),
		);
		const created = await this.#runOperationStep(operation, 'pullRequest', () =>
			this.#api.repository.createPullRequest(
				{
					title: metadata.title,
					body: metadata.body,
					...(input.draft === undefined ? {} : { draft: input.draft }),
					baseBranch: status.baseBranch,
				},
				operation.workstream.id,
			),
		);
		if (!created.url) {
			this.#throwOperationError(
				operation,
				'pullRequest',
				new Error('The pull request was created without a URL'),
			);
		}
		await this.#runOperationStep(operation, 'pullRequest', () =>
			this.#reconcilePullRequestBinding(operation, created),
		);
		if (isPositivePullRequestNumber(created.number)) {
			await this.#rememberGeneratedMetadata(operation, {
				version: 1,
				pullRequestNumber: created.number,
				title: metadata.title,
				body: metadata.body,
			});
		}
		this.#publish({
			...this.#state,
			context: contextFromRepository(
				operation.workstream,
				{ ...status, dirtyPaths: [], ahead: 0 },
				created,
			),
			localError: null,
			pullRequestRefreshStatus: 'ready',
			pullRequestSettledAt: this.#api.clock.now(),
			pullRequestRefreshedAt: this.#api.clock.now(),
			pullRequestError: null,
			error: null,
		});
		return this.refreshLocal();
	}

	async #publishChanges(
		operation: WorkstreamOperation,
		status: Awaited<ReturnType<ExtensionAPI['repository']['status']>>,
		context?: PullRequestAutomationContext,
		changedPaths?: readonly string[],
	): Promise<void> {
		this.#assertStatusMatchesWorkstream(operation, status);
		const metadata = automatedPullRequestMetadata({
			branch: status.branch,
			baseBranch: status.baseBranch,
			changedPaths: mergedChangedPaths(status.dirtyPaths, changedPaths),
			...(context ? { context } : {}),
		});
		if (status.dirtyPaths.length > 0) {
			await this.#runOperationStep(operation, 'local', () =>
				this.#api.repository.commit(
					metadata.commitMessage,
					operation.workstream.id,
					metadata.commitRun ?? undefined,
				),
			);
		}
		await this.#runOperationStep(operation, 'local', () =>
			this.#api.repository.push(operation.workstream.id),
		);
		if ((context?.runSummaries?.length ?? 0) > 0) {
			await this.#refreshGeneratedMetadata(operation, metadata);
		}
	}

	async #refreshGeneratedMetadata(
		operation: WorkstreamOperation,
		metadata: Pick<AutomatedPullRequestMetadata, 'title' | 'body'>,
	): Promise<void> {
		const update = this.#api.repository.updatePullRequestMetadata;
		const store = this.#api.state;
		if (!update || !store) return;
		try {
			const scope = pullRequestBindingScope(operation.workstream.id);
			const generated = parseGeneratedMetadata(
				await store.get(GENERATED_PULL_REQUEST_METADATA_STATE_KEY, scope),
			);
			if (!generated || (generated.title === null && generated.body === null)) return;
			const owned = await update(
				{
					number: generated.pullRequestNumber,
					...(generated.title === null
						? {}
						: { title: { expected: generated.title, next: metadata.title } }),
					...(generated.body === null
						? {}
						: { body: { expected: generated.body, next: metadata.body } }),
				},
				operation.workstream.id,
			);
			await this.#rememberGeneratedMetadata(operation, { ...generated, ...owned });
		} catch {
			return;
		}
	}

	async #rememberGeneratedMetadata(
		operation: WorkstreamOperation,
		generated: GeneratedPullRequestMetadata,
	): Promise<void> {
		this.#assertCurrentWorkstreamOperation(operation);
		await this.#api.state
			?.set(
				GENERATED_PULL_REQUEST_METADATA_STATE_KEY,
				generated,
				pullRequestBindingScope(operation.workstream.id),
			)
			.catch(() => undefined);
	}

	async #mutateTodos(
		mutation: (todos: readonly RepositoryTodo[]) => readonly RepositoryTodo[],
	): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		const previous = this.#todoMutationTail;
		const queued = (async () => {
			await previous;
			this.#assertCurrentWorkstreamOperation(operation);
			if (this.#state.todoStatus !== 'ready') {
				throw new Error(this.#state.todoError ?? 'Workstream todos are not ready yet');
			}
			const next = mutation(cloneRepositoryTodos(this.#state.todos));
			try {
				await this.#todoStore.save(operation.workstream.id, next);
			} catch (error) {
				this.#assertCurrentWorkstreamOperation(operation);
				this.#publish({
					...this.#state,
					todos: [],
					todoStatus: 'error',
					todosObservedAt: null,
					todoError: `Could not save workstream todos: ${errorMessage(error)}`,
				});
				throw error;
			}
			this.#assertCurrentWorkstreamOperation(operation);
			this.#publish({
				...this.#state,
				todos: cloneRepositoryTodos(next),
				todoStatus: 'ready',
				todosObservedAt: this.#api.clock.now(),
				todoError: null,
			});
		})();
		this.#todoMutationTail = queued.catch(() => undefined);
		try {
			await queued;
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return this.snapshot();
			}
			throw error;
		}
		return this.snapshot();
	}

	async #withFreshTodosForMerge<T>(
		operation: WorkstreamOperation,
		action: (todos: readonly RepositoryTodo[]) => Promise<T>,
	): Promise<T> {
		const previous = this.#todoMutationTail;
		const queued = (async () => {
			await previous;
			this.#assertCurrentWorkstreamOperation(operation);
			let todos: readonly RepositoryTodo[];
			try {
				todos = await this.#todoStore.load(operation.workstream.id);
			} catch (error) {
				this.#assertCurrentWorkstreamOperation(operation);
				this.#publish({
					...this.#state,
					todos: [],
					todoStatus: 'error',
					todosObservedAt: null,
					todoError: errorMessage(error),
				});
				this.#throwOperationError(
					operation,
					'pullRequest',
					new Error('Workstream todos are unreadable; review and repair them before merging'),
				);
			}
			this.#assertCurrentWorkstreamOperation(operation);
			const snapshot = cloneRepositoryTodos(todos);
			this.#publish({
				...this.#state,
				todos: snapshot,
				todoStatus: 'ready',
				todosObservedAt: this.#api.clock.now(),
				todoError: null,
			});
			return action(snapshot);
		})();
		this.#todoMutationTail = (async () => {
			try {
				await queued;
			} catch {
				return;
			}
		})();
		return queued;
	}

	#nextTodoId(todos: readonly RepositoryTodo[]): string {
		const prefix = `todo:${this.#api.clock.now()}`;
		let id: string;
		do {
			id = `${prefix}:${++this.#todoSequence}`;
		} while (todos.some((todo) => todo.id === id));
		return id;
	}

	setWorkstream(input: unknown): RepositoryViewState {
		this.#localRefreshSequence += 1;
		this.#pullRequestRefreshSequence += 1;
		this.#pullRequestBindingRevision += 1;
		this.#workstreamGeneration += 1;
		const parsed = parseRepositoryContext(input);
		if (!parsed.ok) {
			this.#publish({
				...createInitialState(null),
				status: 'error',
				localError: parsed.error,
				error: parsed.error,
			});
			return this.snapshot();
		}
		const remembered = this.#rememberedState(parsed.context);
		if (remembered) {
			this.#publish(
				{ ...remembered, status: 'loading', pullRequestRefreshStatus: 'loading' },
				{ announceConflicts: false },
			);
			return this.snapshot();
		}
		this.#publish(
			this.#basePreview(parsed.context, repositoryRootPathOf(input)) ??
				createInitialState(parsed.context),
		);
		return this.snapshot();
	}

	setRepositoryContext(input: unknown): RepositoryViewState {
		this.#localRefreshSequence += 1;
		this.#pullRequestRefreshSequence += 1;
		this.#pullRequestBindingRevision += 1;
		this.#workstreamGeneration += 1;
		const parsed = parseRepositoryContext(input);
		if (!parsed.ok) {
			this.#publish(
				withSynchronizedErrors({
					...this.#state,
					status: 'error',
					localError: parsed.error,
				}),
			);
			return this.snapshot();
		}
		this.#publish({
			...this.#state,
			context: parsed.context,
			status: this.#state.files.length > 0 ? 'ready' : 'empty',
			localError: null,
			pullRequestRefreshStatus: parsed.context.pullRequest ? 'ready' : 'idle',
			pullRequestSettledAt: parsed.context.pullRequest
				? this.#api.clock.now()
				: this.#state.pullRequestSettledAt,
			pullRequestRefreshedAt: parsed.context.pullRequest ? this.#api.clock.now() : null,
			pullRequestError: null,
			error: null,
		});
		return this.snapshot();
	}

	dispose(): void {
		this.#localRefreshSequence += 1;
		this.#pullRequestRefreshSequence += 1;
		this.#pullRequestBindingRevision += 1;
		this.#workstreamGeneration += 1;
		this.#listeners.clear();
		this.#previewListeners.clear();
		this.#workstreamSnapshots.clear();
		this.#unwarmable.clear();
		this.#warming.clear();
		this.#opened.clear();
		this.#disposed = true;
	}

	#restorableState(
		context: RepositoryContext,
		repositoryRootPath: string | null,
	): RepositoryViewState | null {
		return this.#rememberedState(context) ?? this.#basePreview(context, repositoryRootPath);
	}

	#basePreview(
		context: RepositoryContext,
		repositoryRootPath: string | null,
	): RepositoryViewState | null {
		if (!repositoryRootPath || this.#knownWorkstreamIds.has(context.workstreamId)) return null;
		const files = this.#baseFiles.get(baseFilesKey(repositoryRootPath, context.baseBranch));
		return files && files.length > 0 ? { ...createInitialState(context), files } : null;
	}

	async #loadBaseFiles(workstream: ExtensionWorkstream): Promise<void> {
		const readBaseFiles = this.#api.repository.baseFiles;
		const repositoryRootPath = workstream.repositoryRootPath;
		if (!readBaseFiles || !repositoryRootPath || this.#disposed) return;
		const key = baseFilesKey(repositoryRootPath, workstream.baseBranch);
		if (this.#baseFiles.has(key) || this.#baseFileReads.has(key)) return;
		this.#baseFileReads.add(key);
		try {
			const paths = await readBaseFiles(workstream);
			const files = createFileList(
				paths,
				this.#api.settings.get('malini.repository.show-hidden') === true,
			);
			await this.#prepareFiles(files);
			this.#baseFiles.set(key, files);
		} catch {
			return;
		} finally {
			this.#baseFileReads.delete(key);
		}
		for (const listener of [...this.#previewListeners]) listener();
	}

	#rememberedState(context: RepositoryContext): RepositoryViewState | null {
		const remembered = this.#workstreamSnapshots.get(context.workstreamId);
		if (remembered?.context && sameCheckout(remembered.context, context)) {
			const { repositoryFullName: _rememberedFullName, ...rememberedIdentity } = remembered.context;
			return {
				...remembered,
				context: {
					...rememberedIdentity,
					...(context.repositoryFullName ? { repositoryFullName: context.repositoryFullName } : {}),
				},
				mergeConfirmationRequest: null,
			};
		}
		return null;
	}

	#mayWarm(workstream: ExtensionWorkstream): boolean {
		if (this.#warming.has(workstream.id)) return false;
		const failed = this.#unwarmable.get(workstream.id);
		return (
			failed === undefined ||
			failed.branch !== workstream.branch ||
			this.#api.clock.now() - failed.at >= REPOSITORY_WARMUP_RETRY_MS
		);
	}

	#needsWarmup(workstreamId: string): boolean {
		const remembered = this.#workstreamSnapshots.get(workstreamId);
		return (
			!this.#disposed &&
			this.#state.context?.workstreamId !== workstreamId &&
			(remembered === undefined || remembered.pullRequestRefreshedAt === null)
		);
	}

	#markUnwarmable(workstream: ExtensionWorkstream): void {
		this.#unwarmable.set(workstream.id, { branch: workstream.branch, at: this.#api.clock.now() });
	}

	async #readInactiveLocal(workstream: ExtensionWorkstream): Promise<InactiveLocalRead | null> {
		const workstreamId = workstream.id;
		try {
			const [paths, status, diffs, uncommittedDiffs, todos] = await Promise.all([
				this.#api.workstream.listFiles(undefined, workstreamId),
				this.#api.repository.status(workstreamId),
				this.#api.repository.diff(undefined, workstreamId, 'branch'),
				this.#api.repository.diff(undefined, workstreamId, 'uncommitted'),
				this.#todoStore.load(workstreamId),
			]);
			if (status.branch !== workstream.branch || status.baseBranch !== workstream.baseBranch) {
				return null;
			}
			const now = this.#api.clock.now();
			const local = this.#withLocalSnapshot(
				createInitialState(contextFromWorkstream(workstream)),
				workstream,
				{ paths, status, diffs, uncommittedDiffs },
			);
			const state = withSynchronizedErrors({
				...local,
				refreshedAt: now,
				todos: cloneRepositoryTodos(todos),
				todoStatus: 'ready',
				todosObservedAt: now,
			});
			await this.#prepareFiles(state.files);
			return { workstream, status, state };
		} catch {
			return null;
		}
	}

	async #readInactivePullRequestSafely(
		read: InactiveLocalRead,
	): Promise<ExtensionPullRequestContext | null> {
		try {
			return await this.#readInactivePullRequest(read.workstream, read.status);
		} catch {
			return null;
		}
	}

	async #readInactivePullRequest(
		workstream: ExtensionWorkstream,
		status: ExtensionRepositoryStatus,
	): Promise<ExtensionPullRequestContext | null> {
		const stored = this.#api.state
			? await this.#api.state.get(
					PULL_REQUEST_BINDING_STATE_KEY,
					pullRequestBindingScope(workstream.id),
				)
			: null;
		const parsed = parsePullRequestBinding(stored);
		const binding =
			parsed && pullRequestBindingMatchesWorkstream(parsed, workstream) ? parsed : null;
		const maxAgeMs = REPOSITORY_WARMUP_PULL_REQUEST_MAX_AGE_MS;
		const latest = await this.#api.repository.pullRequest(workstream.id, { maxAgeMs });
		const pullRequest =
			!binding || latest.state === 'unavailable' || latest.number === binding.pullRequestNumber
				? latest
				: await this.#api.repository.pullRequest(workstream.id, {
						pullRequestNumber: binding.pullRequestNumber,
						maxAgeMs,
					});
		const describesBranch =
			pullRequest.state === 'not_open' ||
			pullRequest.state === 'unavailable' ||
			(pullRequest.headBranch === workstream.branch &&
				pullRequest.baseBranch === workstream.baseBranch);
		if (!describesBranch) return null;
		if (
			isTerminalPullRequest(pullRequest) &&
			hasChangesAfterTerminalPullRequest(status, pullRequest)
		) {
			return null;
		}
		return pullRequest;
	}

	#rememberWorkstreamState(state: RepositoryViewState): void {
		const workstreamId = state.context?.workstreamId;
		if (!workstreamId || !hasLocalSnapshot(state)) return;
		this.#unwarmable.delete(workstreamId);
		this.#workstreamSnapshots.delete(workstreamId);
		this.#workstreamSnapshots.set(workstreamId, state);
		while (this.#workstreamSnapshots.size > REPOSITORY_WORKSTREAM_SNAPSHOT_LIMIT) {
			const evicted = this.#evictableWorkstream(workstreamId);
			if (evicted === undefined) return;
			this.#workstreamSnapshots.delete(evicted);
			this.#opened.delete(evicted);
		}
	}

	#evictableWorkstream(remembered: string): string | undefined {
		const active = this.#state.context?.workstreamId;
		const evictable = [...this.#workstreamSnapshots.keys()].filter(
			(workstreamId) => workstreamId !== active && workstreamId !== remembered,
		);
		return evictable.find((workstreamId) => !this.#opened.has(workstreamId)) ?? evictable[0];
	}

	#captureWorkstreamOperation(): WorkstreamOperation {
		const current = this.#api.workstream.current();
		const context = this.#state.context;
		if (!current || !context || current.id !== context.workstreamId) {
			throw new Error('Repository operations require an active workstream');
		}
		const { repositoryFullName: _previousRepositoryFullName, ...currentWithoutFullName } = current;
		const workstream: ExtensionWorkstream = {
			...currentWithoutFullName,
			repositoryPath: context.repositoryPath,
			...(context.repositoryFullName ? { repositoryFullName: context.repositoryFullName } : {}),
			branch: context.branch,
			baseBranch: context.baseBranch,
		};
		return { generation: this.#workstreamGeneration, workstream };
	}

	#isCurrentWorkstreamOperation(operation: WorkstreamOperation): boolean {
		return (
			operation.generation === this.#workstreamGeneration &&
			this.#api.workstream.current()?.id === operation.workstream.id &&
			this.#state.context?.workstreamId === operation.workstream.id
		);
	}

	#assertCurrentWorkstreamOperation(operation: WorkstreamOperation): void {
		if (!this.#isCurrentWorkstreamOperation(operation)) {
			throw new StaleWorkstreamOperationError();
		}
	}

	async #loadMutationStatus(operation: WorkstreamOperation): Promise<ExtensionRepositoryStatus> {
		const status = await this.#runOperationStep(operation, 'local', () =>
			this.#api.repository.status(operation.workstream.id),
		);
		this.#assertStatusMatchesWorkstream(operation, status);
		return status;
	}

	#assertStatusMatchesWorkstream(
		operation: WorkstreamOperation,
		status: ExtensionRepositoryStatus,
	): void {
		if (
			status.branch === operation.workstream.branch &&
			status.baseBranch === operation.workstream.baseBranch
		) {
			return;
		}
		this.#throwOperationError(
			operation,
			'local',
			new Error(
				'The repository branch changed; refresh the workstream before modifying repository state',
			),
		);
	}

	async #runOperationStep<T>(
		operation: WorkstreamOperation,
		slice: RepositoryErrorSlice,
		action: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await action();
			this.#assertCurrentWorkstreamOperation(operation);
			return result;
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				throw new StaleWorkstreamOperationError();
			}
			this.#throwOperationError(operation, slice, error);
		}
	}

	#throwOperationError(
		operation: WorkstreamOperation,
		slice: RepositoryErrorSlice,
		error: unknown,
	): never {
		if (!this.#isCurrentWorkstreamOperation(operation)) {
			throw new StaleWorkstreamOperationError();
		}
		const message = errorMessage(error);
		this.#publish(
			withSynchronizedErrors({
				...this.#state,
				...(slice === 'local'
					? { status: 'error' as const, localError: message }
					: {
							pullRequestRefreshStatus: 'error' as const,
							pullRequestSettledAt: this.#api.clock.now(),
							pullRequestError: message,
						}),
			}),
		);
		throw error;
	}

	async #runWorkstreamOperation(
		action: (operation: WorkstreamOperation) => Promise<RepositoryViewState>,
	): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		return this.#runCapturedWorkstreamOperation(operation, action);
	}

	async #runWorkstreamDiagnosticOperation<T>(
		action: (operation: WorkstreamOperation) => Promise<T>,
	): Promise<T | null> {
		const operation = this.#captureWorkstreamOperation();
		try {
			return await action(operation);
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return null;
			}
			throw error;
		}
	}

	async #runWorkstreamMutation(
		action: (operation: WorkstreamOperation) => Promise<RepositoryViewState>,
	): Promise<RepositoryViewState> {
		const operation = this.#captureWorkstreamOperation();
		this.#assertNoActiveMutation(operation.workstream.id);
		this.#activeMutationWorkstreams.add(operation.workstream.id);
		try {
			return await this.#runCapturedWorkstreamOperation(operation, action);
		} finally {
			this.#activeMutationWorkstreams.delete(operation.workstream.id);
		}
	}

	#assertNoActiveMutation(workstreamId: string): void {
		if (this.#activeMutationWorkstreams.has(workstreamId)) {
			throw new Error('Another repository action is already in progress for this workstream');
		}
	}

	async #runCapturedWorkstreamOperation(
		operation: WorkstreamOperation,
		action: (operation: WorkstreamOperation) => Promise<RepositoryViewState>,
	): Promise<RepositoryViewState> {
		try {
			return await action(operation);
		} catch (error) {
			if (
				error instanceof StaleWorkstreamOperationError ||
				!this.#isCurrentWorkstreamOperation(operation)
			) {
				return this.snapshot();
			}
			throw error;
		}
	}

	#announceConflictDetected(next: RepositoryViewState): void {
		const context = next.context;
		const signal = {
			workstreamId: context?.workstreamId ?? null,
			mergeInProgress: context?.mergeInProgress ?? false,
		};
		const previous = this.#conflictSignal;
		this.#conflictSignal = signal;
		if (!context || !signal.mergeInProgress) return;
		if (previous.mergeInProgress && previous.workstreamId === signal.workstreamId) return;
		const events = this.#api.events;
		if (!events) return;
		void Promise.resolve(
			events.emit(EXTENSION_EVENTS.repositoryConflictDetected, {
				workstreamId: context.workstreamId,
				branch: context.branch,
				conflictedPaths: [...context.conflictedPaths],
			}),
		).catch(() => {});
	}

	#publish(
		state: RepositoryViewState,
		options: Readonly<{ announceConflicts?: boolean }> = {},
	): void {
		this.#state = state;
		if (state.context) this.#opened.add(state.context.workstreamId);
		this.#rememberWorkstreamState(state);
		if (options.announceConflicts !== false) this.#announceConflictDetected(state);
		if (this.#listeners.size === 0) return;
		const snapshot = cloneState(state);
		for (const listener of this.#listeners) listener(snapshot);
	}
}

export type RepositoryPanelController = Pick<
	RepositoryController,
	| 'subscribe'
	| 'snapshot'
	| 'workstreamState'
	| 'subscribeWorkstreamPreviews'
	| 'setDiffScope'
	| 'closeAgentSessionDiff'
	| 'selectFile'
	| 'showFile'
	| 'hideFile'
	| 'loadDiff'
>;

function contextFromLocalRepository(
	workstream: ExtensionWorkstream,
	status: ExtensionRepositoryStatus,
	pullRequest: ExtensionPullRequestContext | null,
): RepositoryContext {
	return {
		...contextFromWorkstream(workstream),
		branch: status.branch,
		baseBranch: status.baseBranch,
		dirtyPaths: [...status.dirtyPaths],
		...repositoryLocalSignals(status),
		pullRequest: clonePullRequest(pullRequest),
	};
}

function pullRequestBindingScope(
	workstreamId: string,
): Readonly<{ kind: 'workstream'; id: string }> {
	return { kind: 'workstream', id: workstreamId };
}

function parseGeneratedMetadata(input: unknown): GeneratedPullRequestMetadata | null {
	if (!isRecord(input) || input.version !== 1) return null;
	const text = (value: unknown): string | null | undefined =>
		value === null || typeof value === 'string' ? value : undefined;
	const title = text(input.title);
	const body = text(input.body);
	if (!isPositivePullRequestNumber(input.pullRequestNumber)) return null;
	if (title === undefined || body === undefined) return null;
	return { version: 1, pullRequestNumber: input.pullRequestNumber, title, body };
}

function parsePullRequestBinding(input: unknown): PullRequestBinding | null {
	if (!isRecord(input)) return null;
	const value = input;
	if (
		value.version !== 1 ||
		typeof value.repositoryPath !== 'string' ||
		(value.repositoryFullName !== null && typeof value.repositoryFullName !== 'string') ||
		typeof value.headBranch !== 'string' ||
		typeof value.baseBranch !== 'string' ||
		!isPositivePullRequestNumber(value.pullRequestNumber)
	) {
		return null;
	}
	return {
		version: 1,
		repositoryPath: value.repositoryPath,
		repositoryFullName: value.repositoryFullName,
		headBranch: value.headBranch,
		baseBranch: value.baseBranch,
		pullRequestNumber: value.pullRequestNumber,
	};
}

function pullRequestBindingMatchesWorkstream(
	binding: PullRequestBinding,
	workstream: ExtensionWorkstream,
): boolean {
	return (
		binding.repositoryPath === workstream.repositoryPath &&
		binding.repositoryFullName === (workstream.repositoryFullName ?? null) &&
		binding.headBranch === workstream.branch &&
		binding.baseBranch === workstream.baseBranch
	);
}

function pullRequestBindingFromWorkstream(
	workstream: ExtensionWorkstream,
	pullRequestNumber: number,
): PullRequestBinding {
	return {
		version: 1,
		repositoryPath: workstream.repositoryPath,
		repositoryFullName: workstream.repositoryFullName ?? null,
		headBranch: workstream.branch,
		baseBranch: workstream.baseBranch,
		pullRequestNumber,
	};
}

function isPositivePullRequestNumber(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function clonePullRequest(
	pullRequest: ExtensionPullRequestContext | null,
): ExtensionPullRequestContext | null {
	return pullRequest
		? {
				...pullRequest,
				...(pullRequest.checkItems
					? { checkItems: pullRequest.checkItems.map((check) => ({ ...check })) }
					: {}),
				...(pullRequest.allowedMergeMethods
					? { allowedMergeMethods: [...pullRequest.allowedMergeMethods] }
					: {}),
			}
		: null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function withSynchronizedErrors(state: RepositoryViewState): RepositoryViewState {
	return {
		...state,
		error: [state.localError, state.pullRequestError].filter(Boolean).join('\n') || null,
	};
}

function changeSlice(
	diffs: readonly RepositoryDiff[],
	dirtyPaths: readonly string[],
): RepositoryChangeSlice {
	return {
		diffs,
		changedFiles: changedPathCount(dirtyPaths, diffs),
		additions: diffs.reduce((total, diff) => total + diff.additions, 0),
		deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
	};
}

function changedPathCount(
	dirtyPaths: readonly string[],
	diffs: readonly Pick<RepositoryDiff, 'path'>[],
): number {
	return new Set([...dirtyPaths, ...diffs.map(({ path }) => path)]).size;
}

function mergedChangedPaths(
	statusPaths: readonly string[],
	evidencePaths?: readonly string[],
): readonly string[] {
	return [...new Set([...statusPaths, ...(evidencePaths ?? [])])];
}

function hasUnpublishedChanges(status: ExtensionRepositoryStatus): boolean {
	return status.dirtyPaths.length > 0 || status.ahead > 0;
}

function hasChangesAfterTerminalPullRequest(
	status: ExtensionRepositoryStatus,
	pullRequest: ExtensionPullRequestContext,
): boolean {
	return (
		hasUnpublishedChanges(status) ||
		(pullRequest.includesLocalHead !== true &&
			Boolean(status.headSha) &&
			Boolean(pullRequest.headSha) &&
			status.headSha !== pullRequest.headSha)
	);
}

function isTerminalPullRequest(pullRequest: ExtensionPullRequestContext): boolean {
	return pullRequest.state === 'merged' || pullRequest.state === 'closed';
}

function pullRequestNeedsFixDiagnostics(pullRequest: ExtensionPullRequestContext): boolean {
	if (pullRequest.state !== 'open') return false;
	const checkItems = pullRequest.checkItems ?? [];
	const hasFailedBlockingCheck = pullRequestBlockingChecks(checkItems).some(pullRequestCheckFailed);
	const hasFixableReviewBlocker =
		pullRequest.reviewDecision === 'changes_requested' ||
		(pullRequest.unresolvedReviewThreadCount ?? 0) > 0;
	return (
		(checkItems.length === 0 && pullRequest.checks === 'failed') ||
		hasFailedBlockingCheck ||
		hasFixableReviewBlocker ||
		pullRequest.mergeable === false ||
		['blocked', 'dirty'].includes(pullRequest.mergeableState?.trim().toLocaleLowerCase() ?? '')
	);
}

function notOpenPullRequest(workstream: ExtensionWorkstream): ExtensionPullRequestContext {
	return {
		state: 'not_open',
		number: null,
		title: null,
		url: null,
		baseBranch: workstream.baseBranch,
		headBranch: workstream.branch,
		headSha: null,
		mergeable: null,
		mergeableState: null,
		checks: 'none',
		checkItems: [],
		viewerCanMerge: false,
		allowedMergeMethods: [],
		defaultMergeMethod: null,
		reviewDecision: null,
		unresolvedReviewThreadCount: 0,
	};
}

function baseFilesKey(repositoryRootPath: string, baseBranch: string): string {
	return JSON.stringify([repositoryRootPath, baseBranch]);
}

function repositoryRootPathOf(input: unknown): string | null {
	return isRecord(input) && typeof input.repositoryRootPath === 'string' && input.repositoryRootPath
		? input.repositoryRootPath
		: null;
}

function sameCheckout(left: RepositoryContext, right: RepositoryContext): boolean {
	return (
		left.workstreamId === right.workstreamId &&
		left.repositoryPath === right.repositoryPath &&
		left.branch === right.branch &&
		left.baseBranch === right.baseBranch
	);
}

function hasLocalSnapshot(state: RepositoryViewState): boolean {
	return state.files.length > 0 || state.status === 'empty';
}

function createInitialState(context: RepositoryContext | null): RepositoryViewState {
	return {
		status: 'idle',
		context,
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
		uncommitted: changeSlice([], []),
		refreshedAt: null,
		pullRequestRefreshStatus: 'idle',
		pullRequestRefreshedAt: null,
		pullRequestSettledAt: null,
		localError: null,
		pullRequestError: null,
		error: null,
		todos: [],
		todoStatus: context ? 'loading' : 'error',
		todosObservedAt: null,
		todoError: context ? null : 'Workstream context is unavailable',
		mergeConfirmationRequest: null,
	};
}

function cloneState(state: RepositoryViewState): RepositoryViewState {
	return {
		...state,
		context: state.context
			? {
					...state.context,
					pullRequest: clonePullRequest(state.context.pullRequest),
				}
			: null,
		files: state.files.map((file) => ({ ...file })),
		todos: cloneRepositoryTodos(state.todos),
		diff: state.diff
			? { ...state.diff, lines: state.diff.lines.map((line) => ({ ...line })) }
			: null,
		diffs: state.diffs.map((diff) => ({
			...diff,
			lines: diff.lines.map((line) => ({ ...line })),
		})),
		uncommitted: {
			...state.uncommitted,
			diffs: state.uncommitted.diffs.map((diff) => ({
				...diff,
				lines: diff.lines.map((line) => ({ ...line })),
			})),
		},
		agentSessionDiff: state.agentSessionDiff
			? {
					...state.agentSessionDiff,
					contributingRunIds: [...state.agentSessionDiff.contributingRunIds],
					net: {
						...state.agentSessionDiff.net,
						diff: cloneRepositoryDiff(state.agentSessionDiff.net.diff),
					},
					turns: state.agentSessionDiff.turns.map((turn) => ({
						...turn,
						diff: cloneRepositoryDiff(turn.diff),
					})),
				}
			: null,
		mergeConfirmationRequest: state.mergeConfirmationRequest
			? { ...state.mergeConfirmationRequest }
			: null,
	};
}

export function repositorySurfaceState(state: RepositoryViewState): RepositorySurfaceState {
	const context = state.context;
	return {
		status: state.status,
		workstreamId: context?.workstreamId ?? null,
		branch: context?.branch ?? null,
		baseBranch: context?.baseBranch ?? null,
		dirtyPaths: context ? [...context.dirtyPaths] : [],
		conflictedPaths: context ? [...context.conflictedPaths] : [],
		conflictMarkerPaths: context ? [...context.conflictMarkerPaths] : [],
		ahead: context?.ahead ?? 0,
		behind: context?.behind ?? 0,
		hasUpstream: context?.hasUpstream ?? true,
		mergeInProgress: context?.mergeInProgress ?? false,
		operationInProgress: context?.operationInProgress ?? null,
		changedFiles: state.changedFiles,
		pullRequest: clonePullRequest(context?.pullRequest ?? null),
		pullRequestRefreshStatus: state.pullRequestRefreshStatus,
		pullRequestRefreshedAt: state.pullRequestRefreshedAt,
		pullRequestSettledAt: state.pullRequestSettledAt,
		localError: state.localError,
		pullRequestError: state.pullRequestError,
		error: state.error,
		todoStatus: state.todoStatus,
		todoOpenCount: repositoryTodoOpenCount(state.todos),
		todoError: state.todoError,
	};
}

async function settled(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch {
		return;
	}
}

function cloneRepositoryDiff(diff: RepositoryDiff | null): RepositoryDiff | null {
	return diff ? { ...diff, lines: diff.lines.map((line) => ({ ...line })) } : null;
}
