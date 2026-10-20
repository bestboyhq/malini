<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { restartToUpdateCommand } from '$lib/app/application/commands/restart-to-update.command';
	import { stagedUpdateQuery } from '$lib/app/application/queries/staged-update.query.svelte';
</script>

{#if stagedUpdateQuery.version}
	<div class="border-surface-50-border shrink-0 border-t px-2 py-1.5">
		<Button
			variant="primary-soft"
			size="sm"
			class="w-full"
			loading={stagedUpdateQuery.restarting}
			ariaLabel={`Restart to update to malini ${stagedUpdateQuery.version}`}
			onclick={restartToUpdateCommand}
		>
			{#snippet leading()}
				<Icon name="gift" size={14} />
			{/snippet}
			Restart to update
			{#snippet trailing()}
				<span class="tabular-nums opacity-70">{stagedUpdateQuery.version}</span>
			{/snippet}
		</Button>
	</div>
{/if}
