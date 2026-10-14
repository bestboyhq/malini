import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
import { restartWorkstreamOnBaseCommand } from '$shared/repositories/repositories.api';
import { externalUrlService } from '$shared/system/external-url.service';
import { refreshRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/refresh-repository-surface.command';
import { runPullRequestAbortOperationCommand } from '$lib/pull-requests/application/commands/run-pull-request-abort-operation.command';
import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
import {
	pullRequestAvailabilityOf,
	type PullRequestActionKind,
} from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBar } from '$lib/pull-requests/domain/pull-request-top-bar';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { jobRunsService } from '$lib/pull-requests/infrastructure/services/job-runs.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestActionCommand };

type PullRequestActionEffects = Readonly<{
	onGitStatusStale(): void;
	onArchive(): void;
}>;

function runPullRequestActionCommand(
	clicked: PullRequestActionKind,
	effects: PullRequestActionEffects,
): void {
	const workstreamId = pullRequestScopeStore.workstreamId;
	if (!workstreamId || pullRequestActionStore.busy) return;
	const ship = pullRequestShipAggregate.shipFor(workstreamId);
	const surface = repositorySurfaceAggregate.presentedSurfaceFor(workstreamId);
	const { status, url } = pullRequestTopBar(
		ship,
		surface,
		pullRequestAvailabilityOf(pullRequestScopeStore),
	);
	const offered = [status?.action?.kind, status?.secondaryAction?.kind];
	const kind = offered.includes(clicked) ? clicked : null;
	if (kind === 'open-draft' || kind === 'queue-merge' || kind === 'cancel-merge') {
		sendShipIntentCommand(kind, workstreamId);
		return;
	}
	if (kind === 'reconnect') {
		void goto(REPOSITORIES_HREF);
		return;
	}
	if (kind === 'refresh') {
		refreshRepositorySurfaceCommand();
		return;
	}
	if (kind === 'abort-operation' && surface?.operationInProgress) {
		runPullRequestAbortOperationCommand(surface.operationInProgress, effects.onGitStatusStale);
		return;
	}
	if (kind === 'archive') {
		effects.onArchive();
		return;
	}
	const baseBranch = surface?.baseBranch;
	const mergedHeadSha = surface?.pullRequest?.headSha;
	if (kind === 'continue' && baseBranch && mergedHeadSha) {
		continueOnBase(workstreamId, baseBranch, mergedHeadSha);
		return;
	}
	if (kind === 'open-job' && ship?.needsYou?.jobRunId) {
		openJobTranscript(workstreamId, ship.needsYou.jobRunId, url);
		return;
	}
	if (kind === 'open-pull-request' && url) openPullRequest(url);
}

function continueOnBase(workstreamId: string, baseBranch: string, mergedHeadSha: string): void {
	const revision = pullRequestActionStore.claim('Continuing');
	restartWorkstreamOnBaseCommand(workstreamId, { baseBranch, mergedHeadSha }, () => {
		pullRequestActionStore.release(revision);
		refreshRepositorySurfaceCommand();
	});
}

function openJobTranscript(workstreamId: string, jobRunId: string, url: string | null): void {
	void (async () => {
		const sessionId = await jobRunsService.sessionFor(jobRunId).catch(() => null);
		if (sessionId) {
			await goto(workstreamHref(workstreamId, { agentSessionId: sessionId }));
			return;
		}
		if (url) {
			openPullRequest(url);
			return;
		}
		toast.info('The transcript of that job is no longer available', aboutWorkstream(workstreamId));
	})();
}

function openPullRequest(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
