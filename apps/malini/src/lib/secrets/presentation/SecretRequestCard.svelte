<script lang="ts">
	import { onDestroy } from 'svelte';
	import { followSecretRequestsHook } from '$lib/secrets/application/hooks/follow-secret-requests.hook.svelte';
	import { secretRequestQuery } from '$lib/secrets/application/queries/secret-request.query.svelte';
	import SecretRequestForm from './SecretRequestForm.svelte';

	interface Props {
		sessionId: string | null;
	}

	let { sessionId }: Props = $props();

	const release = followSecretRequestsHook(() => sessionId);
	onDestroy(release);

	const request = $derived(secretRequestQuery.data(sessionId));
</script>

{#if request}
	{#key request.id}
		<SecretRequestForm {request} />
	{/key}
{/if}
