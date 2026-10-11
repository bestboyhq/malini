import { toast } from '$hyper-ui/components/toast';
import type { ShipNeedsYou } from '$contract/pull-requests';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
import { externalUrlService } from '$shared/system/external-url.service';
import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
import { pullRequestAvailabilityOf } from '$lib/pull-requests/domain/pull-request-action';
import { needsYouDestination } from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestTopBar } from '$lib/pull-requests/domain/pull-request-top-bar';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { jobRunsService } from '$lib/pull-requests/infrastructure/services/job-runs.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestActionCommand };

function runPullRequestActionCommand(): void {
	const workstreamId = pullRequestScopeStore.workstreamId;
	if (!workstreamId || pullRequestActionStore.busy) return;
	const ship = pullRequestShipAggregate.shipFor(workstreamId);
	const { action, url } = pullRequestTopBar(
		ship,
		repositorySurfaceAggregate.presentedSurfaceFor(workstreamId),
		pullRequestAvailabilityOf(pullRequestScopeStore),
	);
	if (!action || action.disabled || action.busy) return;
	if (action.kind === 'open-draft' || action.kind === 'queue-merge') {
		sendShipIntentCommand(action.kind, workstreamId);
		return;
	}
	if (action.kind === 'reconnect') {
		void goto(REPOSITORIES_HREF);
		return;
	}
	if (action.kind === 'needs-you' && ship?.needsYou)
		followNeedsYou(workstreamId, ship.needsYou, url);
}

function followNeedsYou(workstreamId: string, needsYou: ShipNeedsYou, url: string | null): void {
	const destination = needsYouDestination(needsYou);
	if (destination === 'repositories') {
		void goto(REPOSITORIES_HREF);
		return;
	}
	if (destination === 'job' && needsYou.jobRunId) {
		openJobTranscript(workstreamId, needsYou.jobRunId, url);
		return;
	}
	if (url) openPullRequest(url);
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
