<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children, wrap = false }: { children: Snippet; wrap?: boolean } = $props();
</script>

<div class="w-full px-5">
	<div
		class={[
			'border-surface-50-border flex items-center gap-x-2 rounded-b-xl border-x-[0.5px] border-b-[0.5px] pr-1.5 pl-3 text-xs',
			wrap ? 'min-h-9 flex-wrap py-1' : 'h-9',
		]}
	>
		{@render children()}
	</div>
</div>
