<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { BusyIcon, ClaudeIcon, Icon } from '$hyper-ui/icons';
	import { catalogModelLabel, pickerModels } from '$shared/providers/domain/model-catalog';
	import type { AgentModel } from '$shared/providers/domain/model-id';
	import { claudeSignInProgress } from '$shared/providers/domain/claude-accounts';
	import { cancelClaudeSignInCommand } from '$shared/providers/application/commands/cancel-claude-sign-in.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { signInToClaudeCommand } from '$shared/providers/application/commands/sign-in-to-claude.command';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { claudeSignInQuery } from '$shared/providers/application/queries/claude-sign-in.query.svelte';
	import { modelCatalogQuery } from '$shared/providers/application/queries/model-catalog.query.svelte';

	interface Props {
		model: AgentModel;
		disabled?: boolean;
		onchange: (model: AgentModel) => void;
	}

	let { model, disabled = false, onchange }: Props = $props();
	let open = $state(false);

	const catalog = $derived(modelCatalogQuery.data);
	const status = $derived(claudeCodeStatusQuery.data);
	const signIn = $derived(claudeSignInQuery.data);
	const signInProgress = $derived(claudeSignInProgress(signIn));
	const models = $derived(pickerModels(catalog, model));
	const selectedLabel = $derived(catalogModelLabel(catalog, model));
	const setupNeeded = $derived(status.kind === 'missing' || status.kind === 'signed-out');
	const setupMessage = $derived(
		status.kind === 'missing'
			? 'Claude Code is not installed on this Mac.'
			: 'Claude Code is installed but not signed in.',
	);

	function select(next: AgentModel): void {
		open = false;
		if (next !== model) onchange(next);
	}

	function onSignIn(): void {
		open = false;
		signInToClaudeCommand();
	}

	function onOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) loadProviderCapabilitiesCommand('stale');
	}

	onMount(() => {
		loadProviderCapabilitiesCommand();
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
				ariaLabel={`Model: ${selectedLabel}${setupNeeded ? ', Claude Code needs setup' : ''}`}
				ariaHasPopup="listbox"
				ariaExpanded={open}
				{disabled}
				class="text-fg-secondary hover:bg-surface-50 h-7 max-w-[min(10rem,100%)] min-w-0 gap-1.5 overflow-hidden rounded-md px-2 text-xs font-normal"
				data-testid="chat-composer-model"
			>
				<ClaudeIcon class="text-fg-secondary shrink-0" size={13} />
				<span class="truncate">{selectedLabel}</span>
				{#if setupNeeded}
					<span
						class="text-warning-content h-1.5 w-1.5 shrink-0 rounded-full bg-current"
						aria-hidden="true"
						data-testid="chat-model-setup-dot"
					></span>
				{/if}
				<Icon
					name="chevron-down"
					class={['shrink-0 transition-transform duration-150', open && 'rotate-180']}
					size={12}
				/>
			</Button>
		{/snippet}

		{#snippet content()}
			<div class="p-1.5" role="listbox" aria-label="Claude models">
				{#each models as option (option.id)}
					{@const selected = option.id === model}
					<DropdownItem
						role="option"
						aria-selected={selected}
						checked={selected}
						class="gap-2.5 py-2"
						data-testid="chat-model-option"
						data-model={option.id}
						onSelect={() => select(option.id)}
					>
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[13px] leading-5">{option.label}</span>
							{#if option.description}
								<span class="text-fg-tertiary text-2xs truncate leading-4">
									{option.description}
								</span>
							{/if}
						</span>
						{#if selected}
							<Icon name="check" class="text-fg-default shrink-0" size={14} />
						{/if}
					</DropdownItem>
				{/each}
			</div>
			{#if signInProgress}
				<div
					class="border-surface-elevated-border flex items-center justify-between gap-2 border-t px-3 py-2.5"
					data-testid="chat-model-sign-in"
				>
					<p class="text-2xs text-fg-tertiary flex items-center gap-2 leading-4">
						<BusyIcon size={12} />
						{signInProgress}
					</p>
					{#if signIn === 'waiting-for-browser'}
						<Button
							variant="secondary"
							size="sm"
							class="shrink-0"
							ariaLabel="Cancel signing in to Claude Code"
							onclick={cancelClaudeSignInCommand}
						>
							Cancel
						</Button>
					{/if}
				</div>
			{:else if setupNeeded}
				<div
					class="border-surface-elevated-border flex items-center justify-between gap-2 border-t px-3 py-2.5"
					data-testid="chat-model-setup"
				>
					<p class="text-2xs text-fg-tertiary leading-4">{setupMessage}</p>
					{#if status.kind === 'signed-out'}
						<Button
							variant="secondary"
							size="sm"
							class="shrink-0"
							ariaLabel="Sign in to Claude Code"
							onclick={onSignIn}
						>
							Sign in
						</Button>
					{:else}
						<Button
							href="/settings"
							variant="secondary"
							size="sm"
							class="shrink-0"
							ariaLabel="Set up Claude Code in Settings"
							onclick={() => (open = false)}
						>
							Set up
						</Button>
					{/if}
				</div>
			{/if}
		{/snippet}
	</Dropdown>
</div>
