<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { loadPermissionGrantsCommand } from '$lib/chat/application/commands/load-permission-grants.command';
	import { revokePermissionGrantCommand } from '$lib/chat/application/commands/revoke-permission-grant.command';
	import { permissionGrantsQuery } from '$lib/chat/application/queries/permission-grants.query.svelte';
	import { permissionGrantWhere } from '$lib/chat/domain/permission-grant';

	const listing = $derived(permissionGrantsQuery.data);

	onMount(loadPermissionGrantsCommand);
</script>

<div
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
>
	{#if listing.failure}
		<p class="text-error-content px-4 py-3 text-xs" role="alert">{listing.failure}</p>
	{/if}
	{#if listing.grants && listing.grants.length > 0}
		<ul aria-label="Always allowed" class="divide-surface-50-border divide-y-[0.5px]">
			{#each listing.grants as grant (grant.id)}
				<li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5">
					<div class="min-w-0">
						<p class="text-fg-default truncate text-sm"><SensitiveText text={grant.what} /></p>
						<p class="text-fg-tertiary text-xs">{permissionGrantWhere(grant)}</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						bordered
						ariaLabel={`Revoke ${grant.what}`}
						onclick={() => revokePermissionGrantCommand(grant.id)}
					>
						Revoke
					</Button>
				</li>
			{/each}
		</ul>
	{:else if listing.grants}
		<p class="text-fg-tertiary px-4 py-3 text-xs">
			Nothing yet. When Claude asks, pick Always allow and the answer shows here.
		</p>
	{/if}
</div>
