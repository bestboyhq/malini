<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChatSurface } from '$lib/chat/chat.api';
	import { InspectorSplit } from '$lib/extensions/extensions.api';
	import {
		WorkstreamProvisioningFrame,
		WorkstreamTitle,
	} from '$shared/repositories/repositories.api';
	import { page } from '$shared/router/state';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const workstreamId = $derived(page.params.workstreamId ?? '');
</script>

<WorkstreamTitle {workstreamId} />

<WorkstreamProvisioningFrame {workstreamId}>
	<InspectorSplit {workstreamId}>
		{#snippet primary()}
			<ChatSurface {workstreamId} />
		{/snippet}
		{#snippet secondary()}
			<div class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
				{@render children()}
			</div>
		{/snippet}
	</InspectorSplit>
</WorkstreamProvisioningFrame>
