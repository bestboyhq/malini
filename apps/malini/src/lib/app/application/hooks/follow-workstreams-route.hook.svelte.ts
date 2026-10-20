import { untrack } from 'svelte';
import {
	activeWorkstreamsQuery,
	checkedOutWorkstreamsQuery,
	connectedRepositoriesQuery,
	workstreamsLoadedQuery,
} from '$shared/repositories/repositories.api';
import { followWorkstreamsRouteCommand } from '$lib/app/application/commands/follow-workstreams-route.command';

export function followWorkstreamsRouteHook(): () => void {
	return $effect.root(() => {
		$effect(() => {
			const workstreams = activeWorkstreamsQuery.data;
			const checkedOut = checkedOutWorkstreamsQuery.data;
			const repositories = connectedRepositoriesQuery.data;
			const loaded = workstreamsLoadedQuery.data;
			untrack(() => followWorkstreamsRouteCommand(workstreams, checkedOut, repositories, loaded));
		});
	});
}
