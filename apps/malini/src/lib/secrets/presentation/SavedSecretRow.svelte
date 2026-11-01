<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import type { SavedSecret } from '$contract/secrets';
	import { deleteSecretCommand } from '$lib/secrets/application/commands/delete-secret.command';
	import { replaceSecretCommand } from '$lib/secrets/application/commands/replace-secret.command';
	import { secretSaveQuery } from '$lib/secrets/application/queries/secret-save.query.svelte';
	import { savedSecretKey } from '$lib/secrets/domain/secret-save';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		secret: SavedSecret;
	}

	let { secret }: Props = $props();

	const SAVED_ON = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

	let replacing = $state(false);
	let value = $state('');
	const save = $derived(secretSaveQuery.data(savedSecretKey(secret.name, secret.repository)));
	const busy = $derived(save?.status === 'saving');

	function onReplace(event: SubmitEvent): void {
		event.preventDefault();
		if (busy || value.trim().length === 0) return;
		replaceSecretCommand(secret, value);
	}
</script>

<li class="flex flex-col gap-2 px-4 py-2.5">
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
		<div class="min-w-0">
			<p class="text-fg-default truncate font-mono text-sm">{secret.name}</p>
			<p class="text-fg-tertiary text-xs">Saved {SAVED_ON.format(new Date(secret.savedAt))}</p>
		</div>
		<div class="flex items-center gap-1.5">
			<Button
				variant="secondary"
				size="sm"
				bordered
				ariaLabel={`Replace ${secret.name}`}
				ariaExpanded={replacing}
				disabled={busy}
				onclick={() => (replacing = !replacing)}
			>
				Replace
			</Button>
			<Button
				variant="secondary"
				size="sm"
				bordered
				ariaLabel={`Delete ${secret.name}`}
				disabled={busy}
				onclick={() => deleteSecretCommand(secret)}
			>
				Delete
			</Button>
		</div>
	</div>
	{#if replacing}
		<form class="flex items-center gap-1.5" onsubmit={onReplace}>
			<TextInput
				type="password"
				autocomplete="off"
				size="sm"
				class="min-w-0 flex-1"
				ariaLabel={`New value for ${secret.name}`}
				placeholder="Paste the new value"
				bind:value
				disabled={busy}
			/>
			<Button
				type="submit"
				variant="primary"
				size="sm"
				disabled={value.trim().length === 0}
				loading={busy}
			>
				Save
			</Button>
		</form>
	{/if}
	{#if save?.status === 'failed'}
		<p class="text-error-content text-xs" role="alert">{sanitizeFailureDetail(save.error)}</p>
	{/if}
</li>
