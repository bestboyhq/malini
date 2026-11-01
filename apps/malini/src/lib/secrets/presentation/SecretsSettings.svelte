<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Well } from '$hyper-ui/components/well';
	import { followSavedSecretsHook } from '$lib/secrets/application/hooks/follow-saved-secrets.hook';
	import { savedSecretsQuery } from '$lib/secrets/application/queries/saved-secrets.query.svelte';
	import { secretGroups } from '$lib/secrets/domain/secret-groups';
	import SavedSecretRow from './SavedSecretRow.svelte';

	const release = followSavedSecretsHook();
	onDestroy(release);

	const listing = $derived(savedSecretsQuery.data);
	const groups = $derived(secretGroups(listing.secrets ?? []));
</script>

<div class="flex flex-col gap-1.5">
	{#if listing.failure}
		<p class="text-error-content px-4 py-3 text-xs" role="alert">{listing.failure}</p>
	{/if}
	{#each groups as group (group.repository ?? '')}
		<Well title={group.repository ?? 'Every repository'}>
			<ul
				aria-label={group.repository ?? 'Every repository'}
				class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
			>
				{#each group.secrets as secret (`${secret.name}:${secret.savedAt}`)}
					<SavedSecretRow {secret} />
				{/each}
			</ul>
		</Well>
	{:else}
		{#if listing.secrets}
			<Well title="Secrets" headed={false}>
				<p
					class="border-surface-50-border bg-surface-50 text-fg-tertiary rounded-xl border-[0.5px] px-4 py-3 text-xs"
				>
					Nothing yet. When an agent asks for a secret, paste it on the card in its chat, and it
					shows here.
				</p>
			</Well>
		{/if}
	{/each}
</div>
