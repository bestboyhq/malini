<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { PageSection } from '$hyper-ui/components/page-section';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { EXTENSIONS_PUBLISHED_HREF } from '$shared/router/routes-hrefs';
	import { loadMarketplaceCommand } from '../application/commands/load-marketplace.command';
	import { searchExtensionsCommand } from '../application/commands/search-extensions.command';
	import { discoverEntriesQuery } from '../application/queries/discover-entries.query.svelte';
	import { marketplaceLoadQuery } from '../application/queries/marketplace-load.query.svelte';
	import { marketplaceSearchQuery } from '../application/queries/marketplace-search.query.svelte';
	import ExtensionRow from './ExtensionRow.svelte';

	const entries = $derived(discoverEntriesQuery.data);
	const load = $derived(marketplaceLoadQuery.data);
	const query = $derived(marketplaceSearchQuery.data);
	const unreachable = $derived(load.state === 'ready' ? load.unreachable : null);
	const note = $derived(unreachable ? 'offline · last list' : `${entries.length}`);

	function onSearch(event: Event): void {
		searchExtensionsCommand(event.target instanceof HTMLInputElement ? event.target.value : '');
	}
</script>

<PageSection
	title="Extensions"
	description="Tools every agent in Malini gets. Install one and every chat has it from the next prompt."
	testId="extensions-discover"
>
	<Well title="Agent tools" {note}>
		{#snippet trailing()}
			<TextInput
				value={query}
				size="xs"
				type="search"
				placeholder="Filter"
				ariaLabel="Filter extensions"
				class="w-48"
				oninput={onSearch}
			>
				{#snippet icon()}
					<Icon name="search" size={12} />
				{/snippet}
			</TextInput>
		{/snippet}
		{#if load.state === 'loading' && entries.length === 0}
			<div class="flex flex-col gap-1.5" aria-label="Loading extensions">
				{#each [0, 1, 2] as row (row)}
					<Skeleton height="52px" class="rounded-xl" />
				{/each}
			</div>
		{:else if load.state === 'failed' || (unreachable && entries.length === 0 && !query.trim())}
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
		{:else if entries.length === 0 && query.trim()}
			<p class="text-fg-tertiary px-3 py-6 text-center text-xs">
				No extension matches “{query.trim()}”.
			</p>
		{:else if entries.length === 0}
			<StateBlock
				heading="Nobody has published an extension yet"
				detail="Publish the first one from a repository with a malini.json."
			>
				{#snippet action()}
					<Button variant="secondary" size="sm" href={EXTENSIONS_PUBLISHED_HREF}>
						Publish one
					</Button>
				{/snippet}
			</StateBlock>
		{:else}
			<ul class="flex flex-col gap-1.5" aria-label="Extensions in the marketplace">
				{#each entries as entry (entry.key)}
					<li><ExtensionRow {entry} /></li>
				{/each}
			</ul>
		{/if}
	</Well>
</PageSection>
