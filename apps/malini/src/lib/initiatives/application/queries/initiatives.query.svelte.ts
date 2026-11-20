import {
	needsYouCount,
	type Initiative,
	type StandingOf,
} from '$lib/initiatives/domain/initiative';
import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';

export type { StandingOf, WorkstreamStanding } from '$lib/initiatives/domain/initiative';

export { initiativesQuery };

class InitiativesQuery {
	public readonly data: readonly Initiative[] = $derived(initiativesAggregate.list);
	public readonly loaded: boolean = $derived(initiativesAggregate.loaded);
	public readonly error: string | null = $derived(initiativesAggregate.error);
	public readonly needsYou: (standingOf: StandingOf) => number = $derived(
		(standingOf: StandingOf) => needsYouCount(initiativesAggregate.list, standingOf),
	);
}

const initiativesQuery = new InitiativesQuery();
