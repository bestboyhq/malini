import type { SelectItem } from '$hyper-ui/components/select';
import { pickerGroups } from '$shared/providers/domain/model-catalog';
import {
	modelSelectionValue,
	type ModelSelection,
} from '$shared/providers/domain/model-preferences';
import type { ProviderGroup } from '$shared/providers/domain/provider';

export { providerSelectOptions };

function providerSelectOptions(
	groups: readonly ProviderGroup[],
	selection: ModelSelection,
): SelectItem[] {
	return pickerGroups(groups, selection).map((group) => ({
		label: group.name,
		options: group.models.map((model) => ({
			value: modelSelectionValue({ provider: group.id, model: model.id }),
			label: model.label,
		})),
	}));
}
