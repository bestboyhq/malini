<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tooltip from '../tooltip/Tooltip.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<span
	class="bg-brand text-brand-content absolute -top-1 -right-2 inline-flex w-fit items-center rounded-md px-1 py-0.5 font-mono text-[0.6rem] leading-tight font-black tracking-wider whitespace-nowrap uppercase"
>
	<Tooltip content="This feature is available only in PRO version" placement="top">
		{@render children()}
	</Tooltip>
</span>
