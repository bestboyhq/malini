import type { UpdateInitiativeDependencyArgs } from '$contract/initiatives';
import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { updateInitiativeDependencyCommand };

function updateInitiativeDependencyCommand(
	id: string,
	change: Omit<UpdateInitiativeDependencyArgs, 'id'>,
): void {
	const title =
		initiativesAggregate.list
			.flatMap(({ dependencies }) => dependencies)
			.find((dependency) => dependency.id === id)?.title ?? '';
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.updateDependency({ ...change, id }));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			const what =
				change.title !== undefined
					? `"${change.title}" not saved`
					: `"${title}" not ${change.done === false ? 'unticked' : 'ticked'}`;
			toast.error(`${what}${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
