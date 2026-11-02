<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { ClaudeIcon, Icon } from '$hyper-ui/icons';
	import {
		allProviderModels,
		catalogModelLabel,
		flatPickerModels,
	} from '$shared/providers/domain/model-catalog';
	import {
		CLAUDE_PROVIDER_ID,
		isModelAccessReady,
		modelAccess,
	} from '$shared/providers/domain/provider';
	import type { ModelSelection } from '$shared/providers/domain/model-preferences';
	import { loadModelProvidersCommand } from '$shared/providers/application/commands/load-model-providers.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';

	interface Props {
		selection: ModelSelection;
		disabled?: boolean;
		onchange: (selection: ModelSelection) => void;
	}

	let { selection, disabled = false, onchange }: Props = $props();
	let open = $state(false);

	const groups = $derived(providerGroupsQuery.data);
	const models = $derived(flatPickerModels(groups, selection));
	const selectedLabel = $derived(catalogModelLabel(allProviderModels(groups), selection.model));
	const claudeStatus = $derived(claudeCodeStatusQuery.data);

	function select(provider: string, model: string): void {
		open = false;
		if (provider !== selection.provider || model !== selection.model) {
			onchange({ provider, model });
		}
	}

	function onOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) {
			loadProviderCapabilitiesCommand('stale');
			loadModelProvidersCommand();
		}
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
		panelClass="w-72"
		contentClass="overflow-hidden"
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
				{#if selection.provider === CLAUDE_PROVIDER_ID}
					<ClaudeIcon class="text-fg-secondary shrink-0" size={13} />
				{:else}
					<Icon name="bolt" class="text-fg-secondary shrink-0" size={13} />
				{/if}
				<span class="truncate">{selectedLabel}</span>
				<Icon
					name="chevron-down"
					class={['shrink-0 transition-transform duration-150', !open && 'rotate-180']}
					size={12}
				/>
			</Button>
		{/snippet}

		{#snippet content()}
			<div class="p-1.5" role="listbox" aria-label="Models">
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
							{#if row.model.description}
								<span class="text-fg-tertiary text-2xs truncate leading-4">
									{row.model.description}
								</span>
							{/if}
						</span>
						{#if !isModelAccessReady(access)}
							<span
								class="text-fg-tertiary text-2xs shrink-0 leading-4"
								data-testid="chat-model-no-access"
							>
								No access
							</span>
						{:else if row.provider !== CLAUDE_PROVIDER_ID}
							<span class="text-fg-tertiary text-2xs shrink-0 leading-4">
								via {row.providerName}
							</span>
						{/if}
						{#if selected}
							<Icon name="check" class="text-fg-default shrink-0" size={14} />
						{/if}
					</DropdownItem>
				{/each}
			</div>
		{/snippet}
	</Dropdown>
</div>
