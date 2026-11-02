<script lang="ts">
	import { onMount } from 'svelte';
	import { Select } from '$hyper-ui/components/select';
	import { loadModelProvidersCommand } from '$shared/providers/application/commands/load-model-providers.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import {
		modelSelectionValue,
		parseModelSelectionValue,
		preferencesWithRoleSelection,
		sameModelSelection,
		type ModelPreferences,
		type ModelRole,
	} from '$shared/providers/domain/model-preferences';
	import { providerSelectOptions } from './provider-select-options';

	interface Props {
		models: ModelPreferences;
		onchange: (models: ModelPreferences) => void;
	}

	let { models, onchange }: Props = $props();

	const ROLES: readonly Readonly<{ role: ModelRole; label: string; description: string }>[] = [
		{
			role: 'planning',
			label: 'Planning model',
			description: 'Used for Plan mode and for producing an implementation-ready plan.',
		},
		{
			role: 'implementation',
			label: 'Implementation model',
			description: 'Used for Agent mode and for implementing an approved plan in a fresh chat.',
		},
	];

	const groups = $derived(providerGroupsQuery.data);

	onMount(() => {
		loadProviderCapabilitiesCommand();
		loadModelProvidersCommand();
	});

	function select(role: ModelRole, value: string): void {
		const selection = parseModelSelectionValue(value, models[role]);
		if (sameModelSelection(selection, models[role])) return;
		onchange(preferencesWithRoleSelection(models, role, selection));
	}
</script>

<div
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
>
	{#each ROLES as { role, label, description } (role)}
		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
			<div class="min-w-0">
				<h3 class="text-fg-default text-sm font-medium">{label}</h3>
				<p class="text-fg-tertiary text-xs">{description}</p>
			</div>
			<Select
				ariaLabel={label}
				value={modelSelectionValue(models[role])}
				options={providerSelectOptions(groups, models[role])}
				onchange={(value) => select(role, value)}
				data-testid={`${role}-model`}
			/>
		</div>
	{/each}
</div>
