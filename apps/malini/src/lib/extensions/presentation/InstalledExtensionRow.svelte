<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { extensionHref } from '$shared/router/routes-hrefs';
	import type { ExtensionEntry } from '../domain/extension-entry';
	import { switchExtensionCommand } from '../application/commands/switch-extension.command';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import ExtensionActionButton from './ExtensionActionButton.svelte';
	import ExtensionCard from './ExtensionCard.svelte';

	interface Props {
		entry: ExtensionEntry;
	}

	let { entry }: Props = $props();

	const action = $derived(extensionActionQuery.data(entry.key));
	const enabled = $derived(entry.installed?.enabled ?? false);
	const withdrawn = $derived(entry.installed?.withdrawn ?? false);
</script>

<ExtensionCard
	title={entry.displayName}
	note={`@${entry.publisher} · ${entry.version}`}
	summary={entry.description}
	href={extensionHref(entry.publisher, entry.name)}
	dimmed={!enabled}
>
	{#snippet trailing()}
		{#if entry.update && !withdrawn}
			<ExtensionActionButton {entry} />
		{/if}
		<Switch
			checked={enabled}
			disabled={withdrawn || action?.status === 'working'}
			ariaLabel={entry.displayName}
			onchange={(on) => switchExtensionCommand(entry, on)}
		/>
	{/snippet}
	{#if withdrawn}
		<p class="text-warning-content text-xs">
			Its publisher withdrew {entry.version}, so Malini turned it off.
		</p>
	{:else if action?.status === 'failed'}
		<p class="text-error-content text-xs" role="alert">{action.error}</p>
	{:else if entry.update && entry.update.newHosts.length > 0}
		<p class="text-fg-tertiary text-xs">
			{entry.update.version} also reaches {entry.update.newHosts.join(', ')}
		</p>
	{/if}
</ExtensionCard>
