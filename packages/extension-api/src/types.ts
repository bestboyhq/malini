import type {
	ExtensionManifest,
	ExtensionCommandManifest,
	ExtensionPanelManifest,
	ExtensionSettingManifest,
	ExtensionWorkflowManifest,
} from './manifest.js';

export type MaybePromise<T> = T | Promise<T>;

export type ExtensionDisposable = {
	dispose(): MaybePromise<void>;
};

export type ExtensionWorkstream = {
	id: string;
	path: string;
	repositoryPath: string;
	repositoryRootPath?: string;
	repositoryFullName?: string;
	branch: string;
	baseBranch: string;
};

export type ExtensionFileStat = {
	kind: 'file' | 'directory';
	size: number;
};

export type ExtensionPanelContext = {
	workstream: ExtensionWorkstream | null;
	settings: Readonly<Record<string, ExtensionSettingValue>>;
	instanceKey?: string;
	executeCommand(id: string, ...args: readonly unknown[]): Promise<unknown>;
};

export type ExtensionPanelOpenOptions = Readonly<{
	label?: string;
	icon?: string;
	tooltip?: string;
}>;

export type ExtensionPanelInstance = ExtensionDisposable & {
	update?(context: ExtensionPanelContext): MaybePromise<void>;
};

export type ExtensionPanelMountTiming = 'after-host-paint' | 'immediate';

export type ExtensionPanelWorkstreamScope = 'runtime' | 'context';

export type ExtensionPanelComponent = {
	mountTiming?: ExtensionPanelMountTiming;
	workstreamScope?: ExtensionPanelWorkstreamScope;
	mount(target: HTMLElement, context: ExtensionPanelContext): MaybePromise<ExtensionPanelInstance>;
};

export type ExtensionPanelRegistration = ExtensionPanelManifest & {
	component: ExtensionPanelComponent;
	onDidOpen?(context: ExtensionPanelContext): MaybePromise<void>;
	onDidClose?(): MaybePromise<void>;
};

export type ExtensionCommandHandler = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type ExtensionCommandRegistration = ExtensionCommandManifest & {
	handler: ExtensionCommandHandler;
};

export type ExtensionSettingValue = string | number | boolean;

export type ExtensionSettingScope =
	{ kind: 'global' } | { kind: 'repository'; id: string } | { kind: 'workstream'; id: string };

export type ExtensionSettingChange = {
	id: string;
	value: ExtensionSettingValue;
	scope: ExtensionSettingScope;
};

export type ExtensionWorkflowContext = {
	workstream: ExtensionWorkstream;
	input: Readonly<Record<string, unknown>>;
	report(update: ExtensionWorkflowUpdate): void;
	signal: AbortSignal;
};

export type ExtensionWorkflowUpdate = {
	status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
	message: string;
	progress?: number;
	data?: Readonly<Record<string, unknown>>;
};

export type ExtensionWorkflowRegistration = ExtensionWorkflowManifest & {
	run(context: ExtensionWorkflowContext): MaybePromise<unknown>;
};

export type ExtensionRepositoryOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export type ExtensionRepositoryStatus = {
	branch: string;
	baseBranch: string;
	dirtyPaths: readonly string[];
	conflictedPaths?: readonly string[];
	conflictMarkerPaths?: readonly string[];
	ahead: number;
	behind: number;
	hasUpstream?: boolean;
	mergeInProgress?: boolean;
	operationInProgress?: ExtensionRepositoryOperation | null;
	headSha?: string | null;
};

export type ExtensionCommitRun = Readonly<{
	id: string;
	messageIfAlreadyCommitted: string;
}>;

export type ExtensionRepositoryDiff = {
	path: string;
	patch: string;
	additions: number;
	deletions: number;
};

export type ExtensionRepositoryDiffScope = 'branch' | 'uncommitted';

export type ExtensionPullRequestChecksState = 'none' | 'unknown' | 'pending' | 'success' | 'failed';

export type ExtensionPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type ExtensionPullRequestReviewDecision =
	'approved' | 'changes_requested' | 'review_required';

export type ExtensionPullRequestCheck = Readonly<{
	name: string;
	appId: number | null;
	state: string;
	conclusion: string | null;
	required: boolean | null;
	url: string | null;
	startedAt: string | null;
	completedAt: string | null;
	notStartedReason?: string | null;
}>;

export type ExtensionPullRequestContext = {
	state: 'not_open' | 'draft' | 'open' | 'merged' | 'closed' | 'unavailable';
	number: number | null;
	title: string | null;
	url: string | null;
	baseBranch: string;
	headBranch: string;
	headSha?: string | null;
	includesLocalHead?: boolean | null;
	mergeable?: boolean | null;
	mergeableState?: string | null;
	behindBase?: number | null;
	checks: ExtensionPullRequestChecksState;
	checkItems?: readonly ExtensionPullRequestCheck[];
	viewerCanMerge?: boolean | null;
	allowedMergeMethods?: readonly ExtensionPullRequestMergeMethod[];
	defaultMergeMethod?: ExtensionPullRequestMergeMethod | null;
	reviewDecision?: ExtensionPullRequestReviewDecision | null;
	unresolvedReviewThreadCount?: number | null;
};

export type ExtensionPullRequestQuery = {
	pullRequestNumber?: number;
	maxAgeMs?: number;
};

export type ExtensionPullRequestCreateInput = {
	title: string;
	body?: string;
	draft?: boolean;
	baseBranch?: string;
};

export type ExtensionPullRequestReadyForReviewInput = {
	number: number;
};

export type ExtensionPullRequestTextUpdate = Readonly<{
	expected: string;
	next: string;
}>;

export type ExtensionPullRequestMetadataUpdate = Readonly<{
	number: number;
	title?: ExtensionPullRequestTextUpdate;
	body?: ExtensionPullRequestTextUpdate;
}>;

export type ExtensionPullRequestMetadata = Readonly<{
	title: string | null;
	body: string | null;
}>;

export type ExtensionPullRequestMergeInput = {
	number: number;
	expectedHeadSha: string;
	mergeMethod?: ExtensionPullRequestMergeMethod;
};

export type ExtensionRestartOnBaseInput = Readonly<{
	baseBranch: string;
	mergedHeadSha: string;
}>;

export type ExtensionPullRequestDiagnosticsQuery = Readonly<{
	number: number;
	expectedHeadSha: string;
}>;

export type ExtensionPullRequestReviewComment = Readonly<{
	id: string;
	authorLogin: string | null;
	body: string;
	createdAt: string;
	updatedAt: string;
}>;

export type ExtensionPullRequestReviewThread = Readonly<{
	id: string;
	path: string;
	line: number | null;
	startLine: number | null;
	side: 'LEFT' | 'RIGHT';
	startSide: 'LEFT' | 'RIGHT' | null;
	subjectType: 'LINE' | 'FILE';
	outdated: boolean;
	comments: readonly ExtensionPullRequestReviewComment[];
}>;

export type ExtensionPullRequestRequestedChangeReview = Readonly<{
	id: string;
	authorLogin: string | null;
	body: string;
	submittedAt: string;
	updatedAt: string;
}>;

export type ExtensionPullRequestReviewFeedback = Readonly<{
	unresolvedThreads: readonly ExtensionPullRequestReviewThread[] | null;
	unresolvedThreadsComplete: boolean;
	requestedChangeReviews: readonly ExtensionPullRequestRequestedChangeReview[] | null;
	requestedChangeReviewsComplete: boolean;
	truncated: boolean;
}>;

export type ExtensionPullRequestCheckAnnotation = Readonly<{
	path: string;
	startLine: number;
	endLine: number;
	startColumn: number | null;
	endColumn: number | null;
	level: 'notice' | 'warning' | 'failure';
	title: string | null;
	message: string;
	rawDetails: string | null;
}>;

export type ExtensionPullRequestCheckRunDiagnostic = Readonly<{
	id: number;
	name: string;
	appId: number;
	status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending' | 'requested';
	conclusion:
		| 'action_required'
		| 'cancelled'
		| 'failure'
		| 'neutral'
		| 'success'
		| 'skipped'
		| 'stale'
		| 'timed_out'
		| 'startup_failure'
		| null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	outputTitle: string | null;
	outputSummary: string | null;
	outputText: string | null;
	annotationsCount: number;
	annotations: readonly ExtensionPullRequestCheckAnnotation[] | null;
	annotationsComplete: boolean;
	logExcerpt: string | null;
}>;

export type ExtensionPullRequestCommitStatusDiagnostic = Readonly<{
	id: number;
	context: string;
	state: 'failure' | 'error';
	description: string | null;
	targetUrl: string | null;
	createdAt: string;
	updatedAt: string;
}>;

export type ExtensionPullRequestCheckDiagnostics = Readonly<{
	checkRuns: readonly ExtensionPullRequestCheckRunDiagnostic[] | null;
	checkRunsComplete: boolean;
	commitStatuses: readonly ExtensionPullRequestCommitStatusDiagnostic[] | null;
	commitStatusesComplete: boolean;
	truncated: boolean;
}>;

export type ExtensionWorkstreamNavigationInput = {
	workstreamId: string;
	source?: {
		provider: string;
		resourceId: string;
	};
};

export type ExtensionWorkstreamEnsureInput = {
	name: string;
	task: string;
	source: {
		provider: string;
		resourceId: string;
		title?: string;
		url?: string;
	};
};

export type ExtensionWorkstreamSummary = {
	id: string;
	name: string;
	branch: string;
	repositoryFullName?: string;
};

export const EXTENSION_EVENTS = {
	extensionReloadRequested: 'malini.extension.reloadRequested',
	workstreamChanging: 'malini.workstream.changing',
	workstreamChanged: 'malini.workstream.changed',
	workstreamClosed: 'malini.workstream.closed',
	workstreamCreated: 'malini.workstream.created',
	workstreamArchived: 'malini.workstream.archived',
	workstreamDeleted: 'malini.workstream.deleted',
	resourceReady: 'malini.resource.ready',
	repositoryRefreshRequested: 'malini.repository.refresh-requested',
	repositoryConflictDetected: 'malini.repository.conflictDetected',
} as const;

export type ExtensionAPI = {
	readonly manifest: ExtensionManifest;
	readonly workstream: {
		current(): ExtensionWorkstream | null;
		list?(): Promise<readonly ExtensionWorkstream[]>;
		listFiles(glob?: string, workstreamId?: string): Promise<readonly string[]>;
		readFile(path: string, workstreamId?: string): Promise<string>;
		readRepositoryFile?(path: string, workstreamId?: string): Promise<string>;
		writeFile(path: string, contents: string, workstreamId?: string): Promise<void>;
		stat(path: string, workstreamId?: string): Promise<ExtensionFileStat | null>;
	};
	readonly repository: {
		status(workstreamId?: string): Promise<ExtensionRepositoryStatus>;
		baseFiles?(workstream: ExtensionWorkstream): Promise<readonly string[]>;
		diff(
			path?: string,
			workstreamId?: string,
			scope?: ExtensionRepositoryDiffScope,
		): Promise<readonly ExtensionRepositoryDiff[]>;
		pullRequest(
			workstreamId?: string,
			query?: ExtensionPullRequestQuery,
		): Promise<ExtensionPullRequestContext>;
		createPullRequest(
			input: ExtensionPullRequestCreateInput,
			workstreamId?: string,
		): Promise<ExtensionPullRequestContext>;
		markPullRequestReadyForReview?(
			input: ExtensionPullRequestReadyForReviewInput,
			workstreamId?: string,
		): Promise<ExtensionPullRequestContext>;
		mergePullRequest?(
			input: ExtensionPullRequestMergeInput,
			workstreamId?: string,
		): Promise<ExtensionPullRequestContext>;
		updatePullRequestMetadata?(
			input: ExtensionPullRequestMetadataUpdate,
			workstreamId?: string,
		): Promise<ExtensionPullRequestMetadata>;
		pullRequestReviewFeedback?(
			input: ExtensionPullRequestDiagnosticsQuery,
			workstreamId?: string,
		): Promise<ExtensionPullRequestReviewFeedback>;
		pullRequestCheckDiagnostics?(
			input: ExtensionPullRequestDiagnosticsQuery,
			workstreamId?: string,
		): Promise<ExtensionPullRequestCheckDiagnostics>;
		refresh(workstreamId?: string): Promise<void>;
		commit(message: string, workstreamId?: string, run?: ExtensionCommitRun): Promise<string>;
		push(workstreamId?: string): Promise<string>;
		pullLatest(baseBranch?: string, workstreamId?: string): Promise<string>;
		restartOnBase?(input: ExtensionRestartOnBaseInput, workstreamId?: string): Promise<string>;
		abortOperation?(workstreamId?: string): Promise<void>;
	};
	readonly panels: {
		register(panel: ExtensionPanelRegistration): ExtensionDisposable;
		open(panelId: string, options?: ExtensionPanelOpenOptions): void;
	};
	readonly commands: {
		register(command: ExtensionCommandRegistration): ExtensionDisposable;
		execute(id: string, ...args: readonly unknown[]): Promise<unknown>;
	};
	readonly settings: {
		register(setting: ExtensionSettingManifest): ExtensionDisposable;
		get(id: string, scope?: ExtensionSettingScope): ExtensionSettingValue;
		set(id: string, value: ExtensionSettingValue, scope?: ExtensionSettingScope): Promise<void>;
		onDidChange(
			listener: (change: ExtensionSettingChange) => MaybePromise<void>,
		): ExtensionDisposable;
	};
	readonly state: {
		get(key: string, scope?: ExtensionSettingScope): Promise<unknown>;
		set<T>(key: string, value: T, scope?: ExtensionSettingScope): Promise<void>;
		delete(key: string, scope?: ExtensionSettingScope): Promise<void>;
	};
	readonly workflows: {
		register(workflow: ExtensionWorkflowRegistration): ExtensionDisposable;
	};
	readonly events: {
		on<T>(event: string, listener: (payload: T) => MaybePromise<void>): ExtensionDisposable;
		emit<T>(event: string, payload: T): Promise<void>;
	};
	readonly notifications: {
		show(input: {
			title: string;
			body: string;
			level?: 'info' | 'success' | 'warning' | 'error';
		}): Promise<void>;
	};
	readonly clock: {
		now(): number;
		sleep(ms: number, signal?: AbortSignal): Promise<void>;
	};
	readonly ids: {
		next(prefix?: string): string;
	};
	readonly ui: {
		openExternal(url: string): Promise<void>;
	};
	readonly navigation?: {
		listWorkstreams(): Promise<readonly ExtensionWorkstreamSummary[]>;
		ensureWorkstream?(input: ExtensionWorkstreamEnsureInput): Promise<ExtensionWorkstreamSummary>;
		openWorkstream(input: ExtensionWorkstreamNavigationInput): Promise<void>;
	};
	readonly secrets: {
		get(key: string): Promise<string | null>;
		set(key: string, value: string): Promise<void>;
		delete(key: string): Promise<void>;
	};
	readonly subscriptions: {
		add(disposable: ExtensionDisposable): ExtensionDisposable;
	};
};

export type ExtensionDeactivationReason = 'deactivate' | 'reload' | 'workstream-transition';

export type ExtensionModule = {
	activate(api: ExtensionAPI): MaybePromise<void>;
	deactivate?(reason: ExtensionDeactivationReason): MaybePromise<void>;
};

export type ExtensionRuntimeState =
	'inactive' | 'activating' | 'active' | 'deactivating' | 'failed';
