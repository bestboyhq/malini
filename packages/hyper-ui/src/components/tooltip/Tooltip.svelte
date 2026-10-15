<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { tooltip, type TooltipPlacement } from './tooltip';

	interface Props {
		content: string | Snippet;
		placement?: TooltipPlacement;
		offset?: number;
		suppressed?: boolean;
		onlyWhenTruncated?: boolean;
		class?: ClassValue;
		children: Snippet;
	}

	const {
		content,
		placement = 'bottom',
		offset,
		suppressed = false,
		onlyWhenTruncated = false,
		class: className,
		children,
	}: Props = $props();

	let source: HTMLSpanElement | undefined = $state();
	const text = $derived(typeof content === 'string' ? content : '');
</script>

{#if typeof content !== 'string'}
	<span hidden bind:this={source}>{@render content()}</span>
{/if}
<span
	class={['flex', className]}
	use:tooltip={suppressed ? null : { text, source, placement, offset, onlyWhenTruncated }}
>
	{@render children()}
</span>
