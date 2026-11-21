<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { repairCheckoutCommand } from '$shared/repositories/application/commands/repair-checkout.command';
	import { checkoutHealthQuery } from '$shared/repositories/application/queries/checkout-health.query.svelte';
	import { CHECKOUT_FINDING_COPY } from './checkout-finding-copy';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const health = $derived(checkoutHealthQuery.data(workstreamId));
	const copy = $derived(CHECKOUT_FINDING_COPY[health.finding ?? 'unknown']);
	const detail = $derived(health.repairable ? (copy.repair ?? copy.instruction) : copy.instruction);
</script>

{#if health.state === 'repairing'}
	<div
		role="status"
		aria-live="polite"
		aria-label="Repairing the checkout"
		data-testid="workstream-checkout-health"
		data-checkout-state={health.state}
		class="border-surface-50-border bg-surface-50 text-fg-secondary flex w-full shrink-0 items-center gap-2 border-b px-4 py-2"
	>
		<span class="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
			<BusyIcon size={13} />
		</span>
		<p class="text-2xs min-w-0 flex-1 truncate leading-4">Repairing the checkout</p>
	</div>
{:else if health.state === 'broken'}
	<div
		role="alert"
		aria-label={copy.headline}
		data-testid="workstream-checkout-health"
		data-checkout-state={health.state}
		data-checkout-finding={health.finding ?? 'unknown'}
		class="border-surface-50-border bg-surface-50 flex w-full shrink-0 items-center gap-3 border-b px-4 py-2"
	>
		<span class="text-error-content grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name="warning" size={13} />
		</span>
		<div class="min-w-0 flex-1">
			<p class="text-2xs text-fg-default leading-4 font-medium">{copy.headline}</p>
			{#if detail}
				<p
					class="text-2xs text-fg-tertiary leading-4"
					data-testid="workstream-checkout-health-detail"
				>
					{detail}
				</p>
			{/if}
		</div>
		{#if health.repairable}
			<Button
				variant="inherit"
				size="auto"
				class="text-2xs text-fg-default shrink-0 px-2 py-1"
				onclick={() => repairCheckoutCommand(workstreamId)}
			>
				Repair
			</Button>
		{/if}
	</div>
{/if}
