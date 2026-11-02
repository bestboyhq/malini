<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import {
		effortsForModel,
		filterPickerModels,
		flatPickerModels,
		modelDescription,
		selectionLabel,
		selectionModels,
	} from '$shared/providers/domain/model-catalog';
	import {
		CLAUDE_PROVIDER_ID,
		isModelAccessReady,
		modelAccess,
	} from '$shared/providers/domain/provider';
	import {
		sameModelPreset,
		type ModelPreset,
		type ModelSelection,
	} from '$shared/providers/domain/model-preferences';
	import {
		reasoningEffortLabel,
		type AgentReasoningEffort,
	} from '$shared/providers/domain/run-profile';
	import { loadModelProvidersCommand } from '$shared/providers/application/commands/load-model-providers.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { refreshModelProvidersCommand } from '$shared/providers/application/commands/refresh-model-providers.command';
	import { toggleModelPresetCommand } from '$shared/providers/application/commands/toggle-model-preset.command';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { modelPresetsQuery } from '$shared/providers/application/queries/model-presets.query.svelte';
	import ProviderIcon from './ProviderIcon.svelte';

	interface Props {
		selection: ModelSelection;
		effort: AgentReasoningEffort;
		disabled?: boolean;
		onchange: (selection: ModelSelection, effort?: AgentReasoningEffort) => void;
	}

	let { selection, effort, disabled = false, onchange }: Props = $props();
	let open = $state(false);
	let query = $state('');
	let filterInput = $state<HTMLInputElement | null>(null);

	const groups = $derived(providerGroupsQuery.data);
	const models = $derived(filterPickerModels(flatPickerModels(groups, selection), query));
	const selectedLabel = $derived(selectionLabel(groups, selection));
	const claudeStatus = $derived(claudeCodeStatusQuery.data);
	const currentPreset: ModelPreset = $derived({
		selection,
		effort:
			effortsForModel(selectionModels(groups, selection), selection.model).length > 0
				? effort
				: null,
	});
	const presets = $derived(
		modelPresetsQuery.data.filter((preset) =>
			models.some(
				(row) =>
					row.provider === preset.selection.provider && row.model.id === preset.selection.model,
			),
		),
	);
	const currentSaved = $derived(
		modelPresetsQuery.data.some((preset) => sameModelPreset(preset, currentPreset)),
	);

	function presetName(preset: ModelPreset): string {
		const label = selectionLabel(groups, preset.selection);
		return preset.effort ? `${label} · ${reasoningEffortLabel(preset.effort)}` : label;
	}

	function select(provider: string, model: string): void {
		open = false;
		if (provider !== selection.provider || model !== selection.model) {
			onchange({ provider, model });
		}
	}

	function applyPreset(preset: ModelPreset): void {
		open = false;
		onchange({ ...preset.selection }, preset.effort ?? undefined);
	}

	function onOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		query = '';
		if (nextOpen) {
			loadProviderCapabilitiesCommand('stale');
			refreshModelProvidersCommand();
			queueMicrotask(() => filterInput?.focus());
		}
	}

	function onFilterKeydown(event: KeyboardEvent): void {
		if (event.key === 'Home' || event.key === 'End') event.stopPropagation();
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		const first = models[0];
		if (first) select(first.provider, first.model.id);
	}

	onMount(() => {
		loadProviderCapabilitiesCommand();
		loadModelProvidersCommand();
	});
</script>

<div class="flex min-w-0">
	<Dropdown
		bind:open
		side="top"
		align="start"
		{onOpenChange}
		panelClass="w-80"
		contentClass="flex max-h-[min(30rem,60vh)] flex-col overflow-hidden"
		testId="chat-model-picker"
		owner="chat-composer"
	>
		{#snippet trigger()}
			<Button
				variant="ghost"
				size="auto"
				active={open}
				ariaLabel={`Model: ${selectedLabel}`}
				ariaHasPopup="listbox"
				ariaExpanded={open}
				{disabled}
				class="text-fg-secondary hover:bg-surface-50 h-7 max-w-[min(10rem,100%)] min-w-0 gap-1.5 overflow-hidden rounded-md px-2 text-xs font-normal"
				data-testid="chat-composer-model"
			>
				<ProviderIcon
					providerId={selection.provider}
					class="text-fg-secondary shrink-0"
					size={13}
				/>
				<span class="truncate">{selectedLabel}</span>
				<Icon
					name="chevron-down"
					class={['shrink-0 transition-transform duration-150', !open && 'rotate-180']}
					size={12}
				/>
			</Button>
		{/snippet}

		{#snippet content()}
			<div class="border-surface-elevated-border shrink-0 border-b-[0.5px] px-1.5 py-1">
				<TextInput
					bare
					size="sm"
					autocomplete="off"
					placeholder="Filter models"
					ariaLabel="Filter models"
					bind:value={query}
					bind:element={filterInput}
					onkeydown={onFilterKeydown}
				>
					{#snippet icon()}
						<Icon name="search" size={12} />
					{/snippet}
				</TextInput>
			</div>
			<div class="min-h-0 overflow-y-auto px-1.5 pt-1.5" role="listbox" aria-label="Models">
				{#if presets.length > 0}
					<div role="group" aria-label="Presets">
						<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">Presets</p>
						{#each presets as preset (presetName(preset) + preset.selection.provider)}
							{@const current = sameModelPreset(preset, currentPreset)}
							<div class="group/preset flex items-center">
								<DropdownItem
									role="option"
									aria-selected={current}
									aria-label={presetName(preset)}
									checked={current}
									class="min-w-0 flex-1 gap-2.5"
									data-testid="chat-model-preset"
									onSelect={() => applyPreset(preset)}
								>
									<ProviderIcon
										providerId={preset.selection.provider}
										class="text-fg-secondary shrink-0"
										size={13}
									/>
									<span class="flex min-w-0 flex-1 items-baseline gap-1.5">
										<span class="truncate leading-5">
											{selectionLabel(groups, preset.selection)}
										</span>
										{#if preset.effort}
											<span class="text-fg-tertiary shrink-0 text-xs">
												{reasoningEffortLabel(preset.effort)}
											</span>
										{/if}
									</span>
									<Icon
										name={current ? 'check' : 'arrow-right'}
										class={['shrink-0', current ? 'text-fg-default' : 'text-fg-tertiary']}
										size={14}
									/>
								</DropdownItem>
								<span
									class="flex w-0 shrink-0 translate-x-3 justify-end overflow-hidden opacity-0 transition-[width,opacity,translate] duration-200 ease-out group-hover/preset:w-8.5 group-hover/preset:translate-x-0 group-hover/preset:opacity-100 group-has-focus-visible/preset:w-8.5 group-has-focus-visible/preset:translate-x-0 group-has-focus-visible/preset:opacity-100 motion-reduce:transition-none"
								>
									<IconButton
										variant="ghost"
										size="auto"
										radius="none"
										class="size-8 rounded-lg"
										ariaLabel={`Remove ${presetName(preset)}`}
										data-testid="chat-model-preset-remove"
										onclick={() => toggleModelPresetCommand(preset)}
									>
										<Icon name="close" size={12} />
									</IconButton>
								</span>
							</div>
						{/each}
					</div>
					<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
				{/if}
				<div role="group" aria-label="Models">
					{#if presets.length > 0}
						<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">Models</p>
					{/if}
					{#each models as row (row.provider + ':' + row.model.id)}
						{@const selected =
							row.provider === selection.provider && row.model.id === selection.model}
						{@const access = modelAccess(
							{ provider: row.provider, model: row.model.id },
							groups,
							claudeStatus,
						)}
						<DropdownItem
							role="option"
							aria-selected={selected}
							checked={selected}
							class="gap-2.5 py-2"
							data-testid="chat-model-option"
							data-provider={row.provider}
							data-model={row.model.id}
							onSelect={() => select(row.provider, row.model.id)}
						>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-[13px] leading-5">{row.model.label}</span>
								{#if modelDescription(row.model)}
									<span class="text-fg-tertiary text-2xs truncate leading-4">
										{modelDescription(row.model)}
									</span>
								{/if}
							</span>
							{#if row.provider !== CLAUDE_PROVIDER_ID || !isModelAccessReady(access)}
								<span class="text-fg-tertiary text-2xs flex shrink-0 flex-col items-end leading-4">
									{#if row.provider !== CLAUDE_PROVIDER_ID}
										<span>via {row.providerName}</span>
									{/if}
									{#if !isModelAccessReady(access)}
										<span data-testid="chat-model-no-access">No access</span>
									{/if}
								</span>
							{/if}
							{#if selected}
								<Icon name="check" class="text-fg-default shrink-0" size={14} />
							{/if}
						</DropdownItem>
					{:else}
						<p class="text-fg-tertiary px-2 py-1.5 text-xs leading-5">No models match</p>
					{/each}
				</div>
			</div>
			<div class="px-1.5 pb-1.5">
				<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
				<DropdownItem
					closeOnSelect={false}
					class="gap-2.5"
					data-testid="chat-model-preset-toggle"
					onSelect={() => toggleModelPresetCommand(currentPreset)}
				>
					<Icon name={currentSaved ? 'minus' : 'plus'} class="shrink-0" size={14} />
					<span class="truncate">
						{currentSaved
							? `Remove ${presetName(currentPreset)} preset`
							: `Save ${presetName(currentPreset)} as a preset`}
					</span>
				</DropdownItem>
			</div>
		{/snippet}
	</Dropdown>
</div>
