<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { BusyIcon, ClaudeIcon, Icon } from '$hyper-ui/icons';
	import { catalogModelLabel, pickerGroups } from '$shared/providers/domain/model-catalog';
	import { CLAUDE_PROVIDER_ID } from '$shared/providers/domain/provider';
	import type { ModelSelection } from '$shared/providers/domain/model-preferences';
	import { claudeSignInProgress } from '$shared/providers/domain/claude-accounts';
	import { cancelClaudeSignInCommand } from '$shared/providers/application/commands/cancel-claude-sign-in.command';
	import { loadModelProvidersCommand } from '$shared/providers/application/commands/load-model-providers.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { signInToClaudeCommand } from '$shared/providers/application/commands/sign-in-to-claude.command';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { claudeSignInQuery } from '$shared/providers/application/queries/claude-sign-in.query.svelte';

	interface Props {
		selection: ModelSelection;
		disabled?: boolean;
		onchange: (selection: ModelSelection) => void;
	}

	let { selection, disabled = false, onchange }: Props = $props();
	let open = $state(false);

	const groups = $derived(pickerGroups(providerGroupsQuery.data, selection));
	const currentGroup = $derived(
		groups.find((group) => group.id === selection.provider) ?? groups[0] ?? null,
	);
	const selectedLabel = $derived(
		catalogModelLabel(
			groups.flatMap((group) => group.models),
			selection.model,
		),
	);
	const status = $derived(claudeCodeStatusQuery.data);
	const signIn = $derived(claudeSignInQuery.data);
	const signInProgress = $derived(claudeSignInProgress(signIn));
	const setupNeeded = $derived(currentGroup !== null && !currentGroup.ready);
	const setupName = $derived(
		currentGroup?.id === CLAUDE_PROVIDER_ID ? 'Claude Code' : (currentGroup?.name ?? 'provider'),
	);
	const setupMessage = $derived(
		currentGroup?.id !== CLAUDE_PROVIDER_ID
			? `Add an API key for ${currentGroup?.name ?? 'this provider'}.`
			: status.kind === 'missing'
				? 'Claude Code is not installed on this Mac.'
				: 'Claude Code is installed but not signed in.',
	);

	function select(provider: string, model: string): void {
		open = false;
		if (provider !== selection.provider || model !== selection.model) {
			onchange({ provider, model });
		}
	}

	function onSignIn(): void {
		open = false;
		signInToClaudeCommand();
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
				ariaLabel={`Model: ${selectedLabel}${setupNeeded ? `, ${setupName} needs setup` : ''}`}
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
				{#if setupNeeded}
					<span
						class="text-warning-content h-1.5 w-1.5 shrink-0 rounded-full bg-current"
						aria-hidden="true"
						data-testid="chat-model-setup-dot"
					></span>
				{/if}
				<Icon
					name="chevron-down"
					class={['shrink-0 transition-transform duration-150', !open && 'rotate-180']}
					size={12}
				/>
			</Button>
		{/snippet}

		{#snippet content()}
			<div class="p-1.5" role="listbox" aria-label="Models">
				{#each groups as group (group.id)}
					<div
						class="text-fg-tertiary text-2xs px-2 pt-1.5 pb-1 font-medium"
						role="presentation"
						data-testid="chat-model-group"
						data-provider={group.id}
					>
						{group.name}
					</div>
					{#each group.models as option (option.id)}
						{@const selected = group.id === selection.provider && option.id === selection.model}
						<DropdownItem
							role="option"
							aria-selected={selected}
							checked={selected}
							class="gap-2.5 py-2"
							data-testid="chat-model-option"
							data-provider={group.id}
							data-model={option.id}
							onSelect={() => select(group.id, option.id)}
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
					{#if currentGroup?.id !== CLAUDE_PROVIDER_ID}
						<Button
							href="/settings"
							variant="secondary"
							size="sm"
							class="shrink-0"
							ariaLabel={`Add an API key for ${currentGroup?.name ?? 'this provider'}`}
							onclick={() => (open = false)}
						>
							Settings
						</Button>
					{:else if status.kind === 'signed-out'}
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
