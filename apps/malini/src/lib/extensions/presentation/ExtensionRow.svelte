<script lang="ts">
	import { extensionHref } from '$shared/router/routes-hrefs';
	import type { ExtensionEntry } from '../domain/extension-entry';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import ExtensionActionButton from './ExtensionActionButton.svelte';
	import ExtensionCard from './ExtensionCard.svelte';

	interface Props {
		entry: ExtensionEntry;
	}

	let { entry }: Props = $props();

	const action = $derived(extensionActionQuery.data(entry.key));
</script>

<ExtensionCard
	title={entry.displayName}
	note={`@${entry.publisher}`}
	summary={entry.description}
	href={extensionHref(entry.publisher, entry.name)}
>
	{#snippet trailing()}
		<ExtensionActionButton {entry} />
	{/snippet}
	{#if action?.status === 'failed'}
		<p class="text-error-content text-xs" role="alert">{action.error}</p>
	{:else if entry.update && entry.update.newHosts.length > 0}
		<p class="text-fg-tertiary text-xs">
			{entry.update.version} also reaches {entry.update.newHosts.join(', ')}
		</p>
	{/if}
</ExtensionCard>
