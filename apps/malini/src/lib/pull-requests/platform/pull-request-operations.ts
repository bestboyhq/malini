import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';

type Operation<Name extends CommandName> = (
	args: CommandArgs<Name>,
) => Promise<CommandResult<Name>>;

export type PullRequestOperations = Readonly<{
	status: Operation<'pull-requests.status'>;
	create: Operation<'pull-requests.create'>;
	markReady: Operation<'pull-requests.mark-ready'>;
	merge: Operation<'pull-requests.merge'>;
	updateMetadata: Operation<'pull-requests.update-metadata'>;
	checkDiagnostics: Operation<'pull-requests.check-diagnostics'>;
	rerunFailedChecks: Operation<'pull-requests.rerun-failed-checks'>;
	reviewFeedback: Operation<'pull-requests.review-feedback'>;
	resolveAddressedReviewThreads: Operation<'pull-requests.resolve-addressed-review-threads'>;
}>;
