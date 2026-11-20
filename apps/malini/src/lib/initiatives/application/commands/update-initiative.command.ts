import type { UpdateInitiativeArgs } from '$contract/initiatives';
import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { updateInitiativeCommand };

function updateInitiativeCommand(id: string, change: Omit<UpdateInitiativeArgs, 'id'>): void {
	const title = initiativesAggregate.list.find((initiative) => initiative.id === id)?.title ?? '';
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.update({ ...change, id }));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			const what =
				change.title === undefined ? `"${title}" not moved` : `"${change.title}" not saved`;
			toast.error(`${what}${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
