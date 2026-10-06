<script lang="ts">
	import { iconLabel, type IconProps } from './icon-props';

	let { class: className, size = 16, ariaLabel }: IconProps = $props();
</script>

<svg
	class={['workstream-busy', className]}
	width={size}
	height={size}
	viewBox="0 0 18 18"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	{...iconLabel(ariaLabel)}
>
	<circle class="dot wave-0" cx="4" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-1" cx="9" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-2" cx="14" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-1" cx="4" cy="9" r="1.4" fill="currentColor" />
	<circle class="dot wave-2" cx="9" cy="9" r="1.4" fill="currentColor" />
	<circle class="dot wave-3" cx="14" cy="9" r="1.4" fill="currentColor" />
	<circle class="dot wave-2" cx="4" cy="14" r="1.4" fill="currentColor" />
	<circle class="dot wave-3" cx="9" cy="14" r="1.4" fill="currentColor" />
	<circle class="dot wave-4" cx="14" cy="14" r="1.4" fill="currentColor" />
</svg>

<style>
	.dot {
		animation: workstream-busy-flow 1.35s ease-in-out infinite;
		opacity: 0.08;
	}

	.wave-1 {
		animation-delay: 70ms;
	}
	.wave-2 {
		animation-delay: 140ms;
	}
	.wave-3 {
		animation-delay: 210ms;
	}
	.wave-4 {
		animation-delay: 280ms;
	}

	@keyframes workstream-busy-flow {
		0%,
		18%,
		100% {
			opacity: 0.72;
		}
		38%,
		78% {
			opacity: 0.08;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
			opacity: 0.52;
		}
	}
</style>
