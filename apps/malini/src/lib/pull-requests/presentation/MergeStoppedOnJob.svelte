<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Icon } from '$hyper-ui/icons';
	import { sendShipIntentCommand } from '$lib/pull-requests/application/commands/send-ship-intent.command';
	import { pullRequestBusyQuery } from '$lib/pull-requests/application/queries/pull-request-busy.query.svelte';

	interface Props {
		workstreamId: string;
		detail: string;
	}

	let { workstreamId, detail }: Props = $props();

	const busy = $derived(pullRequestBusyQuery.data);
</script>

<section
	{@attach avoidedByToasts}
	class="flex items-center gap-2 py-1 pr-1 pl-3 text-xs"
	aria-label="Merge stopped on this job"
	data-testid="merge-stopped-on-job"
>
	<span class="text-warning-content grid size-4 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="alert" size={13} />
	</span>
	<p class="line-clamp-2 min-w-0 flex-1 leading-5">
		<span class="text-fg-default font-medium">The merge stopped on this job</span>
		<span class="text-fg-tertiary">· {detail}</span>
	</p>
	<Button
		variant="secondary"
		size="sm"
		disabled={busy}
		ariaBusy={busy}
		onclick={() => sendShipIntentCommand('retry-merge', workstreamId)}
	>
		Retry merge
	</Button>
</section>
