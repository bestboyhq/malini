<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import type { PublishableExtension } from '$contract/marketplace';
	import { publishExtensionCommand } from '../application/commands/publish-extension.command';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import ExtensionCard from './ExtensionCard.svelte';

	interface Props {
		extension: PublishableExtension;
		canPublish: boolean;
	}

	let { extension, canPublish }: Props = $props();

	const action = $derived(extensionActionQuery.data(`publish:${extension.repositoryId}`));
	const working = $derived(action?.status === 'working');
	const status = $derived(
		extension.liveVersion ? `Live ${extension.liveVersion}` : 'Not published yet',
	);
</script>

<ExtensionCard
	title={extension.displayName ?? extension.repository}
	note={extension.repository}
	summary={status}
>
	{#snippet trailing()}
		{#if extension.version}
			<Button
				variant="primary"
				size="sm"
				loading={working}
				disabled={!canPublish || extension.problem !== null || working}
				onclick={() => publishExtensionCommand(extension)}
			>
				{working ? 'Publishing' : `Publish ${extension.version}`}
			</Button>
		{/if}
	{/snippet}
	{#if action?.status === 'failed'}
		<p class="text-error-content text-xs" role="alert">{action.error}</p>
	{:else if extension.problem}
		<p class="text-warning-content text-xs">{extension.problem}</p>
	{/if}
</ExtensionCard>
