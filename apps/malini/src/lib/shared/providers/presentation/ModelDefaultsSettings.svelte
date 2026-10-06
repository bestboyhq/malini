<script lang="ts">
	import { catalogModelLabel, pickerModels } from '$shared/providers/domain/model-catalog';
	import type {
		ModelPreferences,
		ModelSelection,
	} from '$shared/providers/domain/model-preferences';
	import { modelCatalogQuery } from '$shared/providers/application/queries/model-catalog.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { Sheet } from '$hyper-ui/components/sheet';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamDefaults: ModelPreferences;
		workstreamPreferences: ModelPreferences;
		disabled?: boolean;
		isRunning?: boolean;
		onchange?: (preferences: ModelPreferences) => void;
	}

	let {
		workstreamDefaults,
		workstreamPreferences,
		disabled = false,
		isRunning = false,
		onchange,
	}: Props = $props();

	let open = $state(false);
	let planningKey = $state('');
	let implementationKey = $state('');
	const catalog = $derived(modelCatalogQuery.data);
	const planningOptions: SelectItem[] = $derived(optionsFor(catalog, planningKey));
	const implementationOptions: SelectItem[] = $derived(optionsFor(catalog, implementationKey));

	function optionsFor(models: typeof catalog, current: string): SelectItem[] {
		return pickerModels(models, current).map((model) => ({ value: model.id, label: model.label }));
	}

	function openSettings(): void {
		if (disabled) return;
		planningKey = workstreamDefaults.planning.model;
		implementationKey = workstreamDefaults.implementation.model;
		open = true;
	}

	function save(): void {
		if (!planningKey || !implementationKey) return;
		onchange?.({ planning: { model: planningKey }, implementation: { model: implementationKey } });
		open = false;
	}

	function label(selection: ModelSelection): string {
		return catalogModelLabel(catalog, selection.model);
	}
</script>

<Tooltip content="Model settings" placement="top" suppressed={open}>
	<IconButton
		variant="ghost"
		size="md"
		ariaLabel="Open model settings"
		active={open}
		class="text-fg-tertiary hover:bg-surface-50 rounded-lg"
		data-testid="model-settings-open"
		{disabled}
		onclick={openSettings}
	>
		<Icon name="settings" size={15} />
	</IconButton>
</Tooltip>

<Sheet
	{open}
	title="Model settings"
	description="Choose separate models for planning and implementation."
	onclose={() => (open = false)}
	closeTitle="Close model settings"
>
	<div class="mx-auto grid w-full max-w-2xl gap-5" data-testid="model-settings">
		<div class="border-surface-150-border bg-surface-150 rounded-lg border px-4 py-3">
			<p class="text-fg-secondary text-xs leading-5">
				These are the defaults for every workstream. Saving also applies them to this workstream;
				existing chats keep the role and model they started with.
			</p>
			{#if isRunning}
				<p
					class="text-fg-tertiary mt-1 text-xs leading-5"
					data-testid="model-settings-running-note"
				>
					The current response will not change. New queued turns snapshot these choices.
				</p>
			{/if}
		</div>

		<Select
			id="planning-model"
			label="Planning model"
			description="Used for Plan mode and for producing an implementation-ready plan."
			bind:value={planningKey}
			options={planningOptions}
			data-testid="planning-model"
		/>

		<Select
			id="implementation-model"
			label="Implementation model"
			description="Used for Agent mode and for implementing an approved plan in a fresh chat."
			bind:value={implementationKey}
			options={implementationOptions}
			data-testid="implementation-model"
		/>

		<div
			class="border-surface-150-border bg-surface-150 text-fg-tertiary rounded-lg border px-4 py-3 text-xs leading-5"
		>
			<p>Current workstream: Plan · {label(workstreamPreferences.planning)}</p>
			<p>Current workstream: Build · {label(workstreamPreferences.implementation)}</p>
		</div>

		<div class="flex justify-end gap-2">
			<Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
			<Button
				variant="primary"
				size="sm"
				ariaLabel="Save model settings"
				data-testid="model-settings-save"
				onclick={save}
			>
				Save defaults
			</Button>
		</div>
	</div>
</Sheet>
