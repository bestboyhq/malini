import type { WorktreeOperation } from '$contract/repositories';

export type PullRequestActionKind =
	| 'open-draft'
	| 'queue-merge'
	| 'continue'
	| 'archive'
	| 'cancel-merge'
	| 'open-pull-request'
	| 'open-job'
	| 'reconnect'
	| 'refresh'
	| 'abort-operation';

export type PullRequestAvailability = 'ready' | 'github-unavailable' | 'extension-unavailable';

export type PullRequestTopBarAction = Readonly<{
	kind: PullRequestActionKind;
	label: string;
	ariaLabel: string;
	tone: 'primary' | 'secondary';
	confirmLabel: string | null;
}>;

export type WorkstreamStatusTone = 'idle' | 'ready' | 'queued' | 'needs-you' | 'merged';

export type WorkstreamStatus = Readonly<{
	tone: WorkstreamStatusTone;
	busy: boolean;
	label: string;
	detail: string | null;
	tooltip: string | null;
	action: PullRequestTopBarAction | null;
	secondaryAction?: PullRequestTopBarAction;
}>;

export type PullRequestMenuItemId = 'retry-merge' | 'cancel-merge' | 'abort-operation' | 'refresh';

export type PullRequestMenuItem = Readonly<{
	id: PullRequestMenuItemId;
	label: string;
	confirmLabel: string | null;
}>;

export type PullRequestTopBar = Readonly<{
	status: WorkstreamStatus | null;
	menu: readonly PullRequestMenuItem[];
	remoteFailure: string | null;
	pullRequestNumber: number | null;
	url: string | null;
}>;

export const REPOSITORY_EXTENSION_COMMANDS = Object.freeze({
	status: 'malini.repository.status',
	refresh: 'malini.repository.refresh',
	abortOperation: 'malini.repository.abort-operation',
});

export type PullRequestReadiness = Readonly<{
	repositoryScopeReady: boolean;
	extensionReady: boolean;
	remotePullRequestsSupported: boolean;
	repositoryExtensionRegistered: boolean;
}>;

export function pullRequestAvailabilityOf(
	readiness: PullRequestReadiness,
): PullRequestAvailability {
	if (!readiness.repositoryScopeReady || !readiness.extensionReady) return 'ready';
	if (!readiness.remotePullRequestsSupported) return 'github-unavailable';
	return readiness.repositoryExtensionRegistered ? 'ready' : 'extension-unavailable';
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

export function pullRequestActionFailureDetail(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === 'string' && error.trim()) return error;
	return fallback;
}
