<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChatSurface } from '$lib/chat/chat.api';
	import { announceWorkstreamLifecycleCommand } from '$lib/extensions/application/commands/announce-workstream-lifecycle.command';
	import { InspectorSplit } from '$lib/extensions/extensions.api';
	import { JobCenter } from '$lib/jobs/jobs.api';
	import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import {
		WorkstreamProvisioningFrame,
		WorkstreamTitle,
		archiveWorkstreamCommand,
		workstreamByIdQuery,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const pullRequestShipped = $derived(
		['queued', 'merged'].includes(pullRequestBadgesQuery.data(workstreamId).phase),
	);

	function closeWorkstream(): void {
		if (workstream) archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand);
	}
</script>

<WorkstreamTitle {workstreamId} />

<WorkstreamProvisioningFrame {workstreamId}>
	<InspectorSplit {workstreamId}>
		{#snippet primary()}
			<ChatSurface {workstreamId} {pullRequestShipped} oncloseworkstream={closeWorkstream} />
		{/snippet}
		{#snippet secondary()}
			<div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
				{@render children()}
				<JobCenter docked />
			</div>
		{/snippet}
	</InspectorSplit>
</WorkstreamProvisioningFrame>
