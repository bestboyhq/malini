import { listenGithubCredentialStored } from '$shared/auth/auth-session-events';
import { repairCheckoutsAfterSignInCommand } from '$shared/repositories/application/commands/repair-checkouts-after-sign-in.command';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { checkoutHealthService } from '$shared/repositories/infrastructure/services/checkout-health.service';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';

export function watchCheckoutHealthHook(): () => void {
	const stops = [
		checkoutHealthAggregate.follow((workstreamId) => {
			void workstreamsAggregate.refresh();
			if (activeWorkstreamFreshnessStore.workstreamId === workstreamId) {
				void activeWorkstreamFreshnessStore.refreshNow();
				return;
			}
			void workstreamChangeTotalsAggregate.refreshWorkstream(workstreamId);
		}),
		checkoutHealthService.onCloneProgress((repoId, fraction) => {
			const projects = new Set(
				workstreamsAggregate.projects.filter(({ name }) => name === repoId).map(({ id }) => id),
			);
			for (const { id, projectId } of workstreamsAggregate.workstreams) {
				if (projects.has(projectId)) checkoutHealthAggregate.reportClone(id, fraction);
			}
		}),
		listenGithubCredentialStored(repairCheckoutsAfterSignInCommand),
	];
	return () => {
		for (const stop of stops) stop();
	};
}
