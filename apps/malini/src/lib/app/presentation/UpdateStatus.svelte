<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { checkForUpdatesCommand } from '$lib/app/application/commands/check-for-updates.command';
	import { restartToUpdateCommand } from '$lib/app/application/commands/restart-to-update.command';
	import { restartingToUpdateQuery } from '$lib/app/application/queries/restarting-to-update.query.svelte';
	import { updateStatusQuery } from '$lib/app/application/queries/update-status.query.svelte';

	const status = $derived(updateStatusQuery.data);
</script>

{#if status.state !== 'idle'}
	<div class="border-surface-50-border shrink-0 border-t px-2 py-1.5">
		{#if status.state === 'ready'}
			<Button
				variant="primary-soft"
				size="sm"
				class="w-full"
				loading={restartingToUpdateQuery.data}
				ariaLabel={`Restart to update to malini ${status.version}`}
				onclick={restartToUpdateCommand}
			>
				{#snippet leading()}
					<Icon name="gift" size={14} />
				{/snippet}
				Restart to update
				{#snippet trailing()}
					<span class="tabular-nums opacity-70">{status.version}</span>
				{/snippet}
			</Button>
		{:else if status.state === 'failed'}
			<Tooltip content={status.error} placement="right" class="w-full">
				<Button
					variant="ghost"
					size="sm"
					class="w-full"
					ariaLabel="Update failed, check again"
					onclick={checkForUpdatesCommand}
				>
					{#snippet leading()}
						<Icon name="warning" size={14} class="text-warning-content" />
					{/snippet}
					Update failed
					{#snippet trailing()}
						<span class="opacity-70">Retry</span>
					{/snippet}
				</Button>
			</Tooltip>
		{:else}
			<div
				role="status"
				class="text-fg-secondary text-2xs flex h-6 items-center justify-center gap-1.5 px-2 font-medium whitespace-nowrap"
			>
				{#if status.state === 'up-to-date'}
					<Icon name="check" size={14} class="text-success-content shrink-0" />
					<span class="min-w-0 truncate">Malini is up to date</span>
					<span class="tabular-nums opacity-70">{status.version}</span>
				{:else if status.state === 'downloading'}
					<BusyIcon size={14} class="shrink-0" />
					<span class="min-w-0 truncate">Downloading update</span>
					<span class="tabular-nums opacity-70">{status.version}</span>
				{:else}
					<BusyIcon size={14} class="shrink-0" />
					<span class="min-w-0 truncate">Checking for updates…</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}
