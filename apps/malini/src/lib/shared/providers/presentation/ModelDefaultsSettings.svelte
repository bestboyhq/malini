<script lang="ts">
	import { onMount } from 'svelte';
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { modelCatalogQuery } from '$shared/providers/application/queries/model-catalog.query.svelte';
	import { pickerModels } from '$shared/providers/domain/model-catalog';
	import { isValidAgentModel } from '$shared/providers/domain/model-id';
	import type { ModelPreferences, ModelRole } from '$shared/providers/domain/model-preferences';

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

	const catalog = $derived(modelCatalogQuery.data);

	onMount(loadProviderCapabilitiesCommand);

	function options(current: string): SelectItem[] {
		return pickerModels(catalog, current).map((model) => ({ value: model.id, label: model.label }));
	}

	function select(role: ModelRole, model: string): void {
		if (!isValidAgentModel(model) || model === models[role].model) return;
		onchange({ ...models, [role]: { model } });
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
				value={models[role].model}
				options={options(models[role].model)}
				onchange={(model) => select(role, model)}
				data-testid={`${role}-model`}
			/>
		</div>
	{/each}
</div>
