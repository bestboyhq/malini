import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { deleteInitiativeCommand };

function deleteInitiativeCommand(id: string): void {
	const title = initiativesAggregate.list.find((initiative) => initiative.id === id)?.title ?? '';
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.delete(id));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`"${title}" not deleted${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
