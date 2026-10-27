import { online } from 'svelte/reactivity/window';
import { connectionProblem, type ConnectionProblem } from '$shared/repositories/domain/connection';
import { githubReachAggregate } from '$shared/repositories/infrastructure/aggregates/github-reach.aggregate.svelte';

export { connectionProblemQuery };

class ConnectionProblemQuery {
	public readonly data: ConnectionProblem | null = $derived(
		connectionProblem(online.current !== false, githubReachAggregate.reach),
	);
}

const connectionProblemQuery = new ConnectionProblemQuery();
