<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		text: string;
		class?: ClassValue;
	}

	let { text, class: className }: Props = $props();
</script>

<span class={['relative inline-block whitespace-nowrap', className]}>
	{text}
	<span class="shimmer" aria-hidden="true">
		<span class="shimmer-band">
			<span class="shimmer-copy">{text}</span>
		</span>
	</span>
</span>

<style>
	.shimmer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.shimmer-band {
		position: absolute;
		inset: 0;
		mask-image: linear-gradient(90deg, transparent 30%, black 50%, transparent 70%);
		animation: shimmer-sweep 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	.shimmer-copy {
		display: block;
		color: var(--color-fg-default);
		animation: shimmer-hold 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes shimmer-sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(100%);
		}
	}

	@keyframes shimmer-hold {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(-100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shimmer {
			display: none;
		}
	}
</style>
