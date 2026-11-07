<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="w-full px-5">
	<div
		class="border-surface-50-border flex h-9 items-center gap-2 rounded-b-xl border-x-[0.5px] border-b-[0.5px] pr-1.5 pl-3 text-xs"
	>
		{@render children()}
	</div>
</div>
