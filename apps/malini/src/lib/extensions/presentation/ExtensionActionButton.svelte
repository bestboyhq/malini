<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import type { ExtensionEntry } from '../domain/extension-entry';
	import { installExtensionCommand } from '../application/commands/install-extension.command';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';

	interface Props {
		entry: ExtensionEntry;
		size?: 'sm' | 'md';
	}

	let { entry, size = 'sm' }: Props = $props();

	const action = $derived(extensionActionQuery.data(entry.key));
	const working = $derived(
		action?.status === 'working' && (action.work === 'installing' || action.work === 'updating'),
	);
	const label = $derived(
		entry.update ? `Update to ${entry.update.version}` : `Install ${entry.displayName}`,
	);
</script>

{#if entry.installed && !entry.update}
	<span
		class={[
			'text-fg-tertiary inline-flex shrink-0 items-center gap-1',
			size === 'md' ? 'h-7 text-sm' : 'text-2xs h-6',
		]}
	>
		<Icon name="check" size={size === 'md' ? 14 : 12} />
		Installed
	</span>
{:else}
	<Button
		variant={size === 'md' || entry.update ? 'primary' : 'secondary'}
		{size}
		radius={size === 'md' ? 'full' : 'md'}
		loading={working}
		disabled={working}
		ariaLabel={label}
		onclick={() => installExtensionCommand(entry)}
	>
		{#if working}
			{entry.installed ? 'Updating' : 'Installing'}
		{:else if entry.update}
			Update to {entry.update.version}
		{:else}
			Install
		{/if}
	</Button>
{/if}
