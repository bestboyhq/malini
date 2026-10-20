<script lang="ts">
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
	}

	let { workstreamId }: Props = $props();

	const provisioningRecord = $derived(provisioningRecordQuery.data(workstreamId));
	const retrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const unusableCheckout = $derived(
		!provisioningRecord && workstream && !isWorkstreamCheckoutUsable(workstream)
			? workstream
			: null,
	);
</script>

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
