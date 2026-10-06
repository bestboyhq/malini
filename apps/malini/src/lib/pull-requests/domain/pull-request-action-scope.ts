export type PullRequestActionScope<TExtensionWorkstream> = Readonly<{
	workstreamId: string;
	sessionId: string | null;
	extensionWorkstream: TExtensionWorkstream;
	extensionGeneration: number;
	actionRevision: number;
}>;

export type PullRequestActionScopeSnapshot<TExtensionWorkstream> = Readonly<{
	workstreamId: string;
	sessionId: string | null;
	extensionWorkstream: TExtensionWorkstream | null;
	extensionGeneration: number;
	actionRevision: number;
	ready: boolean;
}>;

export function pullRequestActionScopeIsCurrent<TExtensionWorkstream>(
	scope: PullRequestActionScope<TExtensionWorkstream>,
	current: PullRequestActionScopeSnapshot<TExtensionWorkstream>,
): boolean {
	return (
		current.ready &&
		current.workstreamId === scope.workstreamId &&
		current.sessionId === scope.sessionId &&
		current.extensionWorkstream === scope.extensionWorkstream &&
		current.extensionGeneration === scope.extensionGeneration &&
		current.actionRevision === scope.actionRevision
	);
}

export async function awaitPullRequestActionScope<TExtensionWorkstream, TResult>(
	scope: PullRequestActionScope<TExtensionWorkstream>,
	operation: Promise<TResult>,
	readCurrent: () => PullRequestActionScopeSnapshot<TExtensionWorkstream>,
): Promise<TResult | null> {
	const result = await operation;
	return pullRequestActionScopeIsCurrent(scope, readCurrent()) ? result : null;
}
