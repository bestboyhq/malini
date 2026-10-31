<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { PageSection } from '$hyper-ui/components/page-section';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Well } from '$hyper-ui/components/well';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { EXTENSIONS_HREF } from '$shared/router/routes-hrefs';
	import { installedEntriesQuery } from '../application/queries/installed-entries.query.svelte';
	import InstalledExtensionRow from './InstalledExtensionRow.svelte';

	const installed = $derived(installedEntriesQuery.data);
	const entries = $derived(installed.entries ?? []);
</script>

<PageSection
	title="Installed"
	description="Turn one off and it leaves every chat at its next prompt. Updates that reach no new server install themselves."
	testId="extensions-installed"
>
	<Well title="Agent tools" note={`${entries.length}`}>
		{#if installed.failure}
			<StateBlock
				tone="critical"
				heading="Malini could not read your extensions"
				detail={installed.failure}
				live="alert"
			/>
		{:else if installed.entries === null}
			<div class="flex flex-col gap-1.5" aria-label="Loading extensions">
				{#each [0, 1] as row (row)}
					<Skeleton height="52px" class="rounded-xl" />
				{/each}
			</div>
		{:else if entries.length === 0}
			<StateBlock
				heading="No extensions yet"
				detail="What you install from the marketplace shows here."
			>
				{#snippet action()}
					<Button variant="secondary" size="sm" href={EXTENSIONS_HREF}>Discover extensions</Button>
				{/snippet}
			</StateBlock>
		{:else}
			<ul class="flex flex-col gap-1.5" aria-label="Installed extensions">
				{#each entries as entry (entry.key)}
					<li><InstalledExtensionRow {entry} /></li>
				{/each}
			</ul>
		{/if}
	</Well>
</PageSection>
