import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { linkInitiativeWorkstreamCommand };

function linkInitiativeWorkstreamCommand(dependencyId: string, workstreamId: string): void {
	const title =
		initiativesAggregate.list
			.flatMap(({ dependencies }) => dependencies)
			.find((dependency) => dependency.id === dependencyId)?.title ?? '';
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.linkWorkstream(dependencyId, workstreamId));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(
				`The workstream started, but is not linked to "${title}"${detail ? ` · ${detail}` : ''}.`,
			);
		}
	})();
}
