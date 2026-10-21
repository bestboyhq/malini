<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { lit?: boolean; element?: HTMLElement | undefined; children: Snippet };

	let { lit = false, element = $bindable(), children }: Props = $props();
</script>

<div class={['panel', { lit }]} bind:this={element} data-nosnippet>
	{@render children()}
</div>

<style>
	.panel {
		position: relative;
		overflow: hidden;
		border-radius: var(--window-radius, 14px);
		box-shadow:
			0 0 0 1px var(--ring-faint),
			0 2px 4px rgb(0 0 0 / 0.08),
			0 32px 64px -24px rgb(0 0 0 / 0.45);
	}

	.panel.lit {
		box-shadow: 0 0 0 1px var(--ring-faint);
	}
</style>
