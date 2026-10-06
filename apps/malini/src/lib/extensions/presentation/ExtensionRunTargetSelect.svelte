<script lang="ts">
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';

	interface Props {
		value: string;
		customValue: string;
		label?: string;
		testId?: string;
	}

	let {
		value = $bindable(),
		customValue,
		label = 'Run',
		testId = 'routine-draft-target',
	}: Props = $props();

	const runOptions = $derived(automationRulesStore.runOptions);

	const items = $derived.by((): SelectItem[] => {
		const custom = { value: customValue, label: 'Custom command' };
		const options = runOptions;
		if (!options || options.length === 0) return [custom];
		const group = (kind: 'workflow' | 'command', groupLabel: string) => {
			const grouped = options
				.filter((option) => option.kind === kind)
				.map((option) => ({ value: `${kind}:${option.id}`, label: option.label }));
			return grouped.length > 0 ? [{ label: groupLabel, options: grouped }] : [];
		};
		return [custom, ...group('workflow', 'Workflows'), ...group('command', 'Commands')];
	});
</script>

<Select
	bind:value
	{label}
	{...runOptions === null
		? {
				description:
					'Open a workstream once to pick from its registered workflows and commands; until then, name a command directly.',
			}
		: {}}
	options={items}
	data-testid={testId}
/>
