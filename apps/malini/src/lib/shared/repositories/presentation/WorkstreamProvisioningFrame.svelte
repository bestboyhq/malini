<script lang="ts">
	import type { Snippet } from 'svelte';
	import { removeFailedWorkstreamCommand } from '$shared/repositories/application/commands/remove-failed-workstream.command';
	import { retryProvisioningCommand } from '$shared/repositories/application/commands/retry-provisioning.command';
	import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
	import { provisioningRetryingQuery } from '$shared/repositories/application/queries/provisioning-retrying.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { isWorkstreamCheckoutUsable } from '$shared/repositories/domain/workstream';
	import WorkstreamCheckoutIssue from './WorkstreamCheckoutIssue.svelte';
	import WorkstreamProvisioningFailure from './WorkstreamProvisioningFailure.svelte';

	interface Props {
		workstreamId: string;
		children: Snippet;
	}

	let { workstreamId, children }: Props = $props();

	const provisioningRecord = $derived(provisioningRecordQuery.data(workstreamId));
	const retrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const unusableCheckout = $derived(
		!provisioningRecord && workstream && !isWorkstreamCheckoutUsable(workstream)
			? workstream
			: null,
	);
</script>

<div class="flex h-full min-h-0 w-full flex-1 flex-col">
	{#if provisioningRecord?.failure}
		<WorkstreamProvisioningFailure
			record={provisioningRecord}
			failure={provisioningRecord.failure}
			{retrying}
			onretry={() => retryProvisioningCommand(workstreamId)}
			onremove={() => removeFailedWorkstreamCommand(workstreamId)}
		/>
	{:else if unusableCheckout}
		<WorkstreamCheckoutIssue
			workstreamName={unusableCheckout.name}
			issue={unusableCheckout.checkoutIssue ?? `Its checkout is ${unusableCheckout.checkoutState}`}
		/>
	{/if}
	<div class="flex min-h-0 w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>
