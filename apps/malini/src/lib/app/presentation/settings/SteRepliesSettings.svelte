<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { loadSteRepliesCommand } from '$lib/app/application/commands/load-ste-replies.command';
	import { steRepliesCommand } from '$lib/app/application/commands/ste-replies.command';
	import { steRepliesQuery } from '$lib/app/application/queries/ste-replies.query.svelte';

	const labelId = $props.id();

	onMount(loadSteRepliesCommand);
</script>

<div
	class="border-surface-50-border bg-surface-50 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border-[0.5px] px-4 py-3"
>
	<div class="min-w-0">
		<h3 id={labelId} class="text-fg-default text-sm font-medium">Plain replies</h3>
		<p class="text-fg-tertiary text-xs">
			Short sentences, common words, no filler. A small model checks each reply before you read it
		</p>
	</div>
	<Switch
		checked={steRepliesQuery.on ?? false}
		disabled={steRepliesQuery.on === null}
		labelledBy={labelId}
		onchange={steRepliesCommand}
	/>
</div>
