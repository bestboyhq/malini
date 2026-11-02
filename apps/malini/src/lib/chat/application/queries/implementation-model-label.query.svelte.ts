import { modelDefaultsQuery, modelLabel } from '$shared/providers/providers.api';

export { implementationModelLabelQuery };

class ImplementationModelLabelQuery {
	public readonly data: string = $derived(modelLabel(modelDefaultsQuery.data.implementation.model));
}

const implementationModelLabelQuery = new ImplementationModelLabelQuery();
