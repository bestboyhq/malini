import {
	loadRepositoriesScopeCommand,
	workstreamCreationPendingQuery,
} from '$shared/repositories/repositories.api';

import { knownExtensionWorkstreamsQuery } from '../queries/known-extension-workstreams.query.svelte';
import { warmExtensionRuntimeCommand } from './warm-extension-runtime.command';

export async function warmMostRecentWorkstreamCommand(
	routeWorkstreamId: () => string,
): Promise<void> {
	await loadRepositoriesScopeCommand();
	if (routeWorkstreamId()) return;
	const creationPending = workstreamCreationPendingQuery.data;
	const target = knownExtensionWorkstreamsQuery.data.find(({ id }) => !creationPending(id));
	if (target) warmExtensionRuntimeCommand(target);
}
