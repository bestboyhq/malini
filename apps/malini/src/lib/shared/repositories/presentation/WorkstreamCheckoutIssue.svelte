<script lang="ts">
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamName: string;
		issue: string;
	}

	let { workstreamName, issue }: Props = $props();
</script>

<div
	role="alert"
	data-testid="workstream-checkout-issue"
	class="border-surface-50-border bg-surface-50 flex w-full shrink-0 items-center gap-3 border-b px-4 py-2"
>
	<span class="text-error-content grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="warning" size={13} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="text-2xs text-fg-default leading-4 font-medium">
			{workstreamName} has no usable checkout, so prompts sent here wait instead of running
		</p>
		<Tooltip content={issue} placement="bottom" class="block min-w-0">
			<span
				class="text-2xs text-fg-tertiary block truncate font-mono leading-4"
				data-testid="workstream-checkout-issue-detail"
			>
				{issue}
			</span>
		</Tooltip>
	</div>
</div>
