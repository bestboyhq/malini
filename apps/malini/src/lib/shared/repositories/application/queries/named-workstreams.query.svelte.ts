import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { namedWorkstreamsQuery };

class NamedWorkstreamsQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		workstreamsAggregate.wasNamed(workstreamId),
	);
}

const namedWorkstreamsQuery = new NamedWorkstreamsQuery();
