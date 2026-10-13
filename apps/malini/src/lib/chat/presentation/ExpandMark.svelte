<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		live?: boolean;
		children: Snippet;
	}

	let { live = false, children }: Props = $props();
</script>

<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
	<span
		class="absolute inset-0 grid place-items-center transition-opacity group-open/expand:opacity-0 group-hover/expand:opacity-0 group-aria-expanded/expand:opacity-0"
	>
		<span class={['grid place-items-center', live && 'live text-fg-secondary']}>
			{@render children()}
		</span>
	</span>
	<Icon
		name="plus"
		size={14}
		class="absolute inset-0 opacity-0 transition-opacity group-open/expand:hidden group-hover/expand:opacity-100 group-aria-expanded/expand:hidden"
	/>
	<Icon
		name="minus"
		size={14}
		class="absolute inset-0 opacity-0 transition-opacity group-open/expand:opacity-100 group-aria-expanded/expand:opacity-100"
	/>
</span>

<style>
	.live {
		animation: breathe 1.6s ease-in-out infinite;
	}

	@keyframes breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.live {
			animation: none;
		}
	}
</style>
