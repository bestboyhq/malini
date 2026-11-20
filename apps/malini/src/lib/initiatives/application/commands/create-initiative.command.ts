import { toast } from '$hyper-ui/components/toast';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { createInitiativeCommand };

async function createInitiativeCommand(
	repositoryFullName: string,
	title: string,
	dueOn: string | null,
): Promise<string | null> {
	const known = new Set(initiativesAggregate.list.map(({ id }) => id));
	try {
		const list = await initiativesService.create({ repositoryFullName, title, dueOn });
		initiativesAggregate.set(list);
		return (
			list.find((initiative) => !known.has(initiative.id) && initiative.dueOn === dueOn)?.id ?? null
		);
	} catch (error) {
		const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
		toast.error(`"${title}" not saved${detail ? ` · ${detail}` : ''}. It is still in the field.`);
		return null;
	}
}
