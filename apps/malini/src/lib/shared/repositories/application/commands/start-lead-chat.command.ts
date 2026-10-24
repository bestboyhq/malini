import { toast } from '$hyper-ui/components/toast';
import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
import { leadScopeLabel, type LeadScope } from '$shared/repositories/domain/lead-scope';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';

export { startLeadChatCommand };

function startLeadChatCommand(scope: LeadScope): void {
	void (async () => {
		try {
			const lead = await workstreamsService.createLead(scope);
			workstreamsAggregate.upsert(lead);
			inspectorDrawer.close(lead.id);
			await goto(workstreamHref(lead.id));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			toast.error(`Could not start a chat in ${leadScopeLabel(scope)} · ${reason}`);
		}
	})();
}
