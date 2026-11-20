import type { Initiative } from '$lib/initiatives/domain/initiative';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';

export type { StandingOf, WorkstreamStanding } from '$lib/initiatives/domain/initiative';

export { initiativesQuery };

class InitiativesQuery {
	public readonly loaded: boolean = $derived(initiativesAggregate.loaded);
	public readonly error: string | null = $derived(initiativesAggregate.error);
	public readonly inRepository: (repositoryFullName: string) => readonly Initiative[] = $derived(
		(repositoryFullName: string) =>
			initiativesAggregate.list.filter(
				(initiative) => initiative.repositoryFullName === repositoryFullName,
			),
	);
}

const initiativesQuery = new InitiativesQuery();
