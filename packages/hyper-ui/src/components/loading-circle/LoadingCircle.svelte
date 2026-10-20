<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		size?: number;
		class?: ClassValue;
		dimensions?: string;
		ariaLabel?: string;
	}

	let { size = 16, class: className, dimensions, ariaLabel }: Props = $props();
</script>

<svg
	class={['loading-circle', dimensions, className]}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	role={ariaLabel === undefined ? undefined : 'img'}
	aria-label={ariaLabel}
	aria-hidden={ariaLabel === undefined ? 'true' : undefined}
>
	<circle
		class="loading-circle__arc"
		cx="12"
		cy="12"
		r="9"
		stroke="currentColor"
		stroke-linecap="round"
	/>
</svg>

<style>
	.loading-circle {
		animation: loading-circle-spin 2s linear infinite;
		transform-origin: center;
	}

	.loading-circle__arc {
		stroke-width: 1.75;

		stroke-dasharray: 12 44.5;
		animation:
			loading-circle-sweep 1.4s ease-in-out infinite,
			loading-circle-weight 1.4s ease-in-out infinite;
	}

	@keyframes loading-circle-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes loading-circle-sweep {
		0% {
			stroke-dasharray: 12 44.5;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 40 16.5;
			stroke-dashoffset: -14;
		}
		100% {
			stroke-dasharray: 12 44.5;
			stroke-dashoffset: -56.5;
		}
	}

	@keyframes loading-circle-weight {
		0%,
		100% {
			stroke-width: 1.75;
		}
		50% {
			stroke-width: 3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-circle {
			animation: none;
		}

		.loading-circle__arc {
			stroke-width: 2;
			stroke-dasharray: 42 14.5;
			stroke-dashoffset: 0;
			animation: loading-circle-breathe 1.5s ease-in-out infinite alternate;
		}

		@keyframes loading-circle-breathe {
			to {
				opacity: 0.45;
			}
		}
	}
</style>
