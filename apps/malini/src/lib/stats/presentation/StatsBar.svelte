<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		lead: Snippet;
		children: Snippet;
		value: string;
		share: number;
		testId?: string;
	}

	let { lead, children, value, share, testId }: Props = $props();
</script>

<li class="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-3" data-testid={testId}>
	<span class="flex min-w-0 items-center gap-2">
		{@render lead()}
		<span class="text-fg-default truncate text-[13px]">{@render children()}</span>
	</span>
	<span class="flex h-1.5 items-center" aria-hidden="true">
		<span
			class="bg-activity-4 block h-1.5 rounded-full"
			style={`width: max(${(Math.min(1, share) * 100).toFixed(1)}%, 6px)`}
		></span>
	</span>
	<span class="text-fg-secondary min-w-14 text-right text-[13px] tabular-nums">{value}</span>
</li>
