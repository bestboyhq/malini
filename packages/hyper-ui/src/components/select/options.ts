export type SelectOption = {
	value: string;
	label: string;
	disabled?: boolean;
};

export type SelectOptionGroup = {
	label: string;
	options: SelectOption[];
	disabled?: boolean;
};

export type SelectItem = SelectOption | SelectOptionGroup;

export function isSelectOptionGroup(item: SelectItem): item is SelectOptionGroup {
	return 'options' in item && Array.isArray(item.options);
}

export function flattenSelectOptions(items: SelectItem[]): SelectOption[] {
	return items.flatMap((item) => (isSelectOptionGroup(item) ? item.options : [item]));
}
