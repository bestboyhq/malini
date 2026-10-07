import type { WorktreeOperation } from '$contract/repositories';
import type { RepositorySurface } from './repository-surface';

export type PullRequestActionKind =
	| 'unavailable'
	| 'reconnect'
	| 'retry'
	| 'fix'
	| 'push'
	| 'update'
	| 'create'
	| 'ready'
	| 'todos'
	| 'merge'
	| 'merged'
	| 'open'
	| 'agent-running'
	| 'checking'
	| 'operation'
	| 'no-changes';

export type PullRequestAvailability =
	'ready' | 'agent-running' | 'github-unavailable' | 'extension-unavailable';

export type PullRequestTopBarPresentation = Readonly<{
	kind: PullRequestActionKind;
	label: string;
	busyLabel: string;
	ariaLabel: string;
	tooltip: string;
	disabled: boolean;
	tone: 'primary' | 'secondary';
	confirmLabel: string | null;
	confirmBusyLabel: string | null;
	remoteFailure: string | null;
}>;

export type PullRequestActionContext = Readonly<{
	pullRequestPublished: boolean;
	worktreeFailed: boolean;
}>;

export const REPOSITORY_EXTENSION_COMMANDS = Object.freeze({
	status: 'malini.repository.status',
	refresh: 'malini.repository.refresh',
	refreshPullRequest: 'malini.repository.refresh-pull-request',
	prepareFix: 'malini.repository.prepare-pull-request-fix',
	commitAndPush: 'malini.repository.commit-and-push',
	createOrOpenPullRequest: 'malini.repository.create-or-open-pull-request',
	pullLatest: 'malini.repository.pull-latest',
	continueAfterMerge: 'malini.repository.continue-after-merge',
	abortOperation: 'malini.repository.abort-operation',
	requestMergeConfirmation: 'malini.repository.request-merge-confirmation',
	markPullRequestReady: 'malini.repository.mark-pull-request-ready',
	todos: 'malini.repository.todos',
	filesPanel: 'malini.repository.files-panel',
});

export type PullRequestReadiness = Readonly<{
	repositoryScopeReady: boolean;
	extensionReady: boolean;
	remotePullRequestsSupported: boolean;
	repositoryExtensionRegistered: boolean;
	agentRunning: boolean;
}>;

export function pullRequestAvailabilityOf(
	readiness: PullRequestReadiness,
): PullRequestAvailability {
	const ready = readiness.agentRunning ? 'agent-running' : 'ready';
	if (!readiness.repositoryScopeReady || !readiness.extensionReady) return ready;
	if (!readiness.remotePullRequestsSupported) return 'github-unavailable';
	return readiness.repositoryExtensionRegistered ? ready : 'extension-unavailable';
}

export function pullRequestActionCommandId(
	kind: PullRequestActionKind,
	context: PullRequestActionContext,
): string {
	if (kind === 'fix') return REPOSITORY_EXTENSION_COMMANDS.prepareFix;
	if (kind === 'push' && context.pullRequestPublished) {
		return REPOSITORY_EXTENSION_COMMANDS.commitAndPush;
	}
	if (kind === 'create' || kind === 'push') {
		return REPOSITORY_EXTENSION_COMMANDS.createOrOpenPullRequest;
	}
	if (kind === 'update') return REPOSITORY_EXTENSION_COMMANDS.pullLatest;
	if (kind === 'merge') return REPOSITORY_EXTENSION_COMMANDS.requestMergeConfirmation;
	if (kind === 'retry' && context.worktreeFailed) return REPOSITORY_EXTENSION_COMMANDS.refresh;
	if (kind === 'ready') return REPOSITORY_EXTENSION_COMMANDS.markPullRequestReady;
	return REPOSITORY_EXTENSION_COMMANDS.refreshPullRequest;
}

export function pullRequestActionSucceededMessage(
	kind: PullRequestActionKind,
	hadUncommitted = false,
): string | null {
	if (kind === 'create') return 'Pull request created';
	if (kind === 'push') return hadUncommitted ? 'Changes committed and pushed' : 'Pushed';
	if (kind === 'update') return 'Branch updated';
	if (kind === 'ready') return 'Pull request is ready for review';
	return null;
}

export type PullRequestActionOutcome = Readonly<{
	level: 'success' | 'info';
	message: string;
}>;

export function pullRequestActionOutcome(
	kind: PullRequestActionKind,
	before: RepositorySurface | null,
	after: RepositorySurface,
	resolvedReviewThreads = 0,
): PullRequestActionOutcome | null {
	if (kind === 'update' && after.conflictedPaths.length > 0) {
		return {
			level: 'info',
			message: 'The update stopped on merge conflicts. Resolve conflicts to finish it',
		};
	}
	const message =
		kind === 'push' && before?.operationInProgress === 'merge'
			? 'Merge committed and pushed'
			: pullRequestActionSucceededMessage(kind, (before?.dirtyPaths.length ?? 0) > 0);
	if (!message) return null;
	return {
		level: 'success',
		message:
			resolvedReviewThreads > 0
				? `${message} · ${reviewThreads(resolvedReviewThreads)} resolved`
				: message,
	};
}

export function alreadyAddressedReviewThreadsMessage(resolved: number): string {
	return `${reviewThreads(resolved)} resolved · already addressed on GitHub`;
}

export function reviewThreadsLeftOpenMessage(failures: readonly string[]): string | null {
	const [failure] = failures;
	if (failure === undefined) return null;
	return `${failures.length === 1 ? 'A review thread was' : `${failures.length} review threads were`} left open · ${failure}`;
}

function reviewThreads(count: number): string {
	return `${count} review thread${count === 1 ? '' : 's'}`;
}

const OPERATION_NOUNS: Readonly<Record<WorktreeOperation, string>> = {
	merge: 'Merge',
	rebase: 'Rebase',
	'cherry-pick': 'Cherry-pick',
	revert: 'Revert',
};

export function worktreeOperationNoun(operation: WorktreeOperation): string {
	return OPERATION_NOUNS[operation];
}

export function pullRequestActionRefreshesGitStatus(kind: PullRequestActionKind): boolean {
	return kind === 'create' || kind === 'push' || kind === 'update';
}

export function pullRequestActionFailureDetail(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === 'string' && error.trim()) return error;
	return fallback;
}
