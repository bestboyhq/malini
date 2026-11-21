import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { addInitiativeDependencyCommand };

function addInitiativeDependencyCommand(initiativeId: string, title: string): void {
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.addDependency(initiativeId, title));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`"${title}" not added${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
