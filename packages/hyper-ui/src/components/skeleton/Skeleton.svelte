<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	type Shape = 'rect' | 'circle' | 'text';

	interface Props {
		shape?: Shape;
		width?: string;
		height?: string;
		class?: ClassValue;
		ariaLabel?: string;
	}

	const {
		shape = 'rect',
		width,
		height,
		class: className,
		ariaLabel = 'Loading',
	}: Props = $props();

	const radiusClass: Record<Shape, string> = {
		rect: 'rounded-md',
		circle: 'rounded-full',
		text: 'rounded',
	};
</script>

<span
	class={['skeleton bg-surface-150-selected block', radiusClass[shape], className]}
	style:width
	style:height
	role="status"
	aria-label={ariaLabel}
	aria-busy="true"
></span>

<style>
	.skeleton {
		position: relative;
		overflow: hidden;
		isolation: isolate;
		contain: paint;
	}

	.skeleton::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgb(255 255 255 / 0.08) 50%,
			transparent 100%
		);
		pointer-events: none;
		transform: translate3d(-110%, 0, 0);
		will-change: transform;
		animation: skeleton-shimmer 2.8s linear infinite;
	}

	:global([data-theme='dark']) .skeleton::after {
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgb(255 255 255 / 0.05) 50%,
			transparent 100%
		);
	}

	@keyframes skeleton-shimmer {
		from {
			transform: translate3d(-110%, 0, 0);
		}
		to {
			transform: translate3d(110%, 0, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton::after {
			animation: none;
			opacity: 0;
			will-change: auto;
		}
	}
</style>
