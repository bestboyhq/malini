<script lang="ts">
	import { checkoutHealthQuery } from '$shared/repositories/application/queries/checkout-health.query.svelte';
	import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { isWorkstreamCheckoutUsable } from '$shared/repositories/domain/workstream';
	import WorkstreamCheckoutIssue from './WorkstreamCheckoutIssue.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const provisioningRecord = $derived(provisioningRecordQuery.data(workstreamId));
	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const checkoutDiagnosed = $derived(checkoutHealthQuery.data(workstreamId).state !== 'healthy');
	const unusableCheckout = $derived(
		!provisioningRecord &&
			!checkoutDiagnosed &&
			workstream &&
			!isWorkstreamCheckoutUsable(workstream)
			? workstream
			: null,
	);
</script>

{#if unusableCheckout}
	<WorkstreamCheckoutIssue
		workstreamName={unusableCheckout.name}
		issue={unusableCheckout.checkoutIssue ?? `Its checkout is ${unusableCheckout.checkoutState}`}
	/>
{/if}
