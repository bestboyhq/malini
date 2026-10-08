import { acceptRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/accept-repository-surface.command';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import type { PullRequestActionInput } from '@malini-extension/repository';
import type { ExtensionWorkstream } from '@malini/extension-api';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
import { DEFERRED_PULL_REQUEST_ACTION_TTL_MS } from '$lib/pull-requests/domain/deferred-pull-request-action';
import { goto } from '$shared/router/navigation';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	pullRequestActionCommandId,
	type PullRequestTopBarPresentation,
	pullRequestActionFailureDetail,
	pullRequestActionOutcome,
	pullRequestActionRefreshesGitStatus,
	pullRequestAvailabilityOf,
	pullRequestMergeInput,
	reviewThreadsLeftOpenMessage,
} from '$lib/pull-requests/domain/pull-request-action';
import {
	awaitPullRequestActionScope,
	type PullRequestActionScope,
} from '$lib/pull-requests/domain/pull-request-action-scope';
import {
	pullRequestFixPromptToSend,
	type PullRequestFixDiagnostics,
} from '$lib/pull-requests/domain/pull-request-fix-prompt';
import { pullRequestTopBarPresentation } from '$lib/pull-requests/domain/pull-request-top-bar';
import type {
	RepositoryCommandOutcome,
	SurfacePullRequest,
} from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { externalUrlService } from '$shared/system/external-url.service';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { reviewThreadsService } from '$lib/pull-requests/infrastructure/services/review-threads.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestActionCommand };

type PullRequestActionSeams = Readonly<{
	submitPrompt(prompt: string): Promise<void>;
	chatEvidence(): PullRequestActionInput;
	onPanelRequested(panelId: string): void;
	onGitStatusStale(): void;
}>;

type ExtensionWorkstreamScope = PullRequestActionScope<ExtensionWorkstream>;

type ActionResult = Readonly<{
	outcome: RepositoryCommandOutcome | null;
	diagnostics: PullRequestFixDiagnostics | null;
}>;

function runPullRequestActionCommand(seams: PullRequestActionSeams): void {
	runPullRequestAction(seams, 'clicked');
}

function runPullRequestAction(seams: PullRequestActionSeams, origin: 'clicked' | 'replayed'): void {
	const surface = repositorySurfaceAggregate.presentedSurfaceFor(
		pullRequestScopeStore.workstreamId,
	);
	const presentation = pullRequestTopBarPresentation(
		surface,
		pullRequestAvailabilityOf(pullRequestScopeStore),
	);
	if (pullRequestActionStore.busy || !presentation || presentation.disabled) return;

	const kind = presentation.kind;
	if (kind === 'unavailable' || kind === 'merged') return;
	if (kind === 'open') {
		const url = surface?.pullRequest?.url;
		if (url) void externalUrlService.open(url).catch(() => undefined);
		return;
	}
	if (kind === 'todos') {
		seams.onPanelRequested(REPOSITORY_EXTENSION_COMMANDS.filesPanel);
		return;
	}
	if (kind === 'reconnect') {
		void goto(REPOSITORIES_HREF);
		return;
	}

	const pullRequest = surface?.pullRequest ?? null;
	const scope = pullRequestScopeStore.claim(presentation.busyLabel);
	if (!scope) {
		if (origin === 'clicked') deferUntilTheScopeIsReady(presentation, pullRequest, seams);
		return;
	}

	const commandId = pullRequestActionCommandId(kind, {
		pullRequestPublished: pullRequest?.state === 'open' || pullRequest?.state === 'draft',
		worktreeFailed: Boolean(surface?.localError),
	});
	const evidence = kind === 'create' || kind === 'push' ? seams.chatEvidence() : null;
	const input = evidence ?? (kind === 'merge' ? pullRequestMergeInput(pullRequest) : undefined);

	void (async () => {
		try {
			const result =
				kind === 'fix'
					? await runFix(scope, commandId)
					: { outcome: await runAction(scope, commandId, input), diagnostics: null };
			if (!result.outcome) return;
			const resolvedThreads = await resolveAddressedReviewThreads(
				scope,
				evidence?.context?.latestRunId,
			);
			const outcome =
				resolvedThreads > 0 ? await refreshedOutcome(scope, result.outcome) : result.outcome;
			if (!pullRequestScopeStore.isCurrent(scope)) return;

			const nextSurface = outcome.surface;
			acceptRepositorySurfaceCommand(scope.workstreamId, nextSurface);

			const prompt =
				kind === 'fix' ? pullRequestFixPromptToSend(nextSurface, result.diagnostics) : null;
			if (prompt) {
				seams.onPanelRequested(REPOSITORY_EXTENSION_COMMANDS.filesPanel);
				await seams.submitPrompt(prompt.text);
				if (!pullRequestScopeStore.isCurrent(scope)) return;
			}

			const announced = pullRequestActionOutcome(kind, nextSurface, resolvedThreads);
			if (announced) {
				toast[announced.level](announced.message, aboutWorkstream(scope.workstreamId));
			}
			if (pullRequestActionRefreshesGitStatus(kind)) seams.onGitStatusStale();
		} catch (error) {
			if (!pullRequestScopeStore.isCurrent(scope)) return;
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, 'The pull request action could not be completed')}`,
				aboutWorkstream(scope.workstreamId),
			);
		} finally {
			pullRequestActionStore.release(scope.actionRevision);
		}
	})();
}

function deferUntilTheScopeIsReady(
	presentation: PullRequestTopBarPresentation,
	pullRequest: SurfacePullRequest | null,
	seams: PullRequestActionSeams,
): void {
	const workstreamId = pullRequestScopeStore.workstreamId;
	if (!workstreamId) return;
	const token = pullRequestActionStore.defer(
		{
			workstreamId,
			clicked: {
				kind: presentation.kind,
				label: presentation.label,
				ariaLabel: presentation.ariaLabel,
				clickedAt: Date.now(),
				headSha: pullRequest?.headSha ?? null,
			},
			replay: () => runPullRequestAction(seams, 'replayed'),
		},
		pullRequestScopeStore.extensionReady,
	);
	setTimeout(() => pullRequestActionStore.dropDeferred(token), DEFERRED_PULL_REQUEST_ACTION_TTL_MS);
}

async function runFix(scope: ExtensionWorkstreamScope, commandId: string): Promise<ActionResult> {
	if (!pullRequestScopeStore.isCurrent(scope)) return { outcome: null, diagnostics: null };
	const preparation = await awaitPullRequestActionScope(
		scope,
		repositoryExtensionService.prepareFix(scope.workstreamId, commandId),
		() => pullRequestScopeStore.snapshot(),
	);
	if (!pullRequestScopeStore.isCurrent(scope)) return { outcome: null, diagnostics: null };
	const outcome =
		preparation?.outcome ??
		(await runAction(scope, REPOSITORY_EXTENSION_COMMANDS.status, undefined));
	return { outcome, diagnostics: preparation?.diagnostics ?? null };
}

async function resolveAddressedReviewThreads(
	scope: ExtensionWorkstreamScope,
	runId: string | undefined,
): Promise<number> {
	if (!runId) return 0;
	const { resolvedThreadIds, failures } = await reviewThreadsService.resolveAddressed(
		scope.workstreamId,
		runId,
	);
	const leftOpen = reviewThreadsLeftOpenMessage(failures);
	if (leftOpen) toast.error(leftOpen, aboutWorkstream(scope.workstreamId));
	return resolvedThreadIds.length;
}

async function refreshedOutcome(
	scope: ExtensionWorkstreamScope,
	pushed: RepositoryCommandOutcome,
): Promise<RepositoryCommandOutcome> {
	const refreshed = await runAction(
		scope,
		REPOSITORY_EXTENSION_COMMANDS.refreshPullRequest,
		undefined,
	).catch(() => null);
	return refreshed ?? pushed;
}

async function runAction(
	scope: ExtensionWorkstreamScope,
	commandId: string,
	input: unknown,
): Promise<RepositoryCommandOutcome | null> {
	if (!pullRequestScopeStore.isCurrent(scope)) return null;
	return awaitPullRequestActionScope(
		scope,
		repositoryExtensionService.execute(scope.workstreamId, commandId, input),
		() => pullRequestScopeStore.snapshot(),
	);
}
