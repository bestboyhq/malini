import type { ModelSelection } from '$shared/providers/domain/model-preferences';
import { modelAccess, type ModelAccess } from '$shared/providers/domain/provider';
import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';

export { modelAccessQuery };

class ModelAccessQuery {
	public readonly data: (selection: ModelSelection) => ModelAccess = $derived(
		(selection: ModelSelection) =>
			modelAccess(selection, providerGroupsQuery.data, claudeCodeStatusQuery.data),
	);
}

const modelAccessQuery = new ModelAccessQuery();
