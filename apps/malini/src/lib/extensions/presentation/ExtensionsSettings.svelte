<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { PROFILE_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { entryMatches } from '../domain/extension-entry';
	import { loadMarketplaceCommand } from '../application/commands/load-marketplace.command';
	import { followMarketplaceHook } from '../application/hooks/follow-marketplace.hook';
	import { installedEntriesQuery } from '../application/queries/installed-entries.query.svelte';
	import { marketplaceEntriesQuery } from '../application/queries/marketplace-entries.query.svelte';
	import { marketplaceLoadQuery } from '../application/queries/marketplace-load.query.svelte';
	import ExtensionItem from './ExtensionItem.svelte';

	const LIST =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-xl border-[0.5px]';

	let query = $state('');

	const installed = $derived(installedEntriesQuery.data);
	const available = $derived(marketplaceEntriesQuery.data);
	const load = $derived(marketplaceLoadQuery.data);
	const unreachable = $derived(load.state === 'ready' ? load.unreachable : null);
	const installedCount = $derived(installed.entries?.length ?? 0);
	const shownInstalled = $derived(
		(installed.entries ?? []).filter((entry) => entryMatches(entry, query)),
	);
	const shownAvailable = $derived(available.filter((entry) => entryMatches(entry, query)));
	const filter = $derived(query.trim());

	onMount(() => {
		loadMarketplaceCommand();
		return followMarketplaceHook();
	});
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	{#if installedCount + available.length > 0}
		<div class="flex h-8 items-center px-1.5">
			<TextInput
				bind:value={query}
				size="xs"
				type="search"
				placeholder="Filter"
				ariaLabel="Filter extensions"
				class="min-w-0 flex-1"
			>
				{#snippet icon()}
					<Icon name="search" size={12} />
				{/snippet}
			</TextInput>
		</div>
	{/if}

	{#if installed.failure}
		<StateBlock
			tone="critical"
			heading="Malini could not read your extensions"
			detail={installed.failure}
			live="alert"
		/>
	{:else if shownInstalled.length > 0}
		<Well title="Installed" note={`${shownInstalled.length}`}>
			<ul class={LIST} aria-label="Installed extensions">
				{#each shownInstalled as entry (entry.key)}
					<ExtensionItem {entry} />
				{/each}
			</ul>
		</Well>
	{/if}

	<Well title="From the marketplace">
		{#if load.state === 'loading' && available.length === 0}
			<div class="flex flex-col gap-1.5" aria-label="Loading extensions">
				{#each [0, 1, 2] as row (row)}
					<Skeleton height="52px" class="rounded-xl" />
				{/each}
			</div>
		{:else if load.state === 'failed' || (unreachable && available.length === 0)}
			<StateBlock
				tone="critical"
				heading="Malini could not reach the marketplace"
				detail={load.state === 'failed' ? load.error : unreachable}
				live="alert"
			>
				{#snippet action()}
					<Button variant="secondary" size="sm" onclick={() => loadMarketplaceCommand()}>
						Try again
					</Button>
				{/snippet}
			</StateBlock>
		{:else if shownAvailable.length === 0}
			<p class="text-fg-tertiary px-3 py-6 text-center text-xs">
				{#if filter}
					No extension matches “{filter}”.
				{:else if installedCount > 0}
					You installed every extension there is.
				{:else}
					Nobody has published an extension yet.
				{/if}
			</p>
		{:else}
			<ul class={LIST} aria-label="Extensions in the marketplace">
				{#each shownAvailable as entry (entry.key)}
					<ExtensionItem {entry} />
				{/each}
			</ul>
		{/if}
	</Well>

	<p class="text-fg-tertiary px-3 pt-1 text-xs">
		Made one?
		<a
			href={PROFILE_SETTINGS_HREF}
			class="text-fg-secondary hover:text-fg-default underline underline-offset-2"
		>
			Publish it from Profile
		</a>
	</p>
</div>
