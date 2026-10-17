<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		lead: Snippet;
		children: Snippet;
		value: string;
		share: number;
		testId?: string;
		details?: Snippet;
	}

	let { lead, children, value, share, testId, details }: Props = $props();

	const detailsId = $props.id();
	let expanded = $state(false);
</script>

{#snippet row()}
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
{/snippet}

<li data-testid={testId}>
	{#if details}
		<Button
			bare
			class="hover:bg-surface-elevated-hover focus-visible:bg-surface-elevated-hover -mx-1.5 grid w-[calc(100%+12px)] cursor-pointer grid-cols-[minmax(0,1fr)_96px_auto_12px] items-center gap-3 rounded-md px-1.5 py-0.5 text-left outline-none"
			ariaExpanded={expanded}
			ariaControls={detailsId}
			onclick={() => (expanded = !expanded)}
		>
			{@render row()}
			<Icon
				name="chevron-right"
				size={12}
				class={['text-fg-tertiary transition-transform duration-200', expanded && 'rotate-90']}
			/>
		</Button>
		{#if expanded}
			<div id={detailsId}>{@render details()}</div>
		{/if}
	{:else}
		<div class="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-3">
			{@render row()}
		</div>
	{/if}
</li>
