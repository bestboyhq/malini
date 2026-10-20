<script lang="ts">
	import { iconLabel, type IconProps } from './icon-props';

	interface Props extends IconProps {
		background?: boolean;
	}

	let { class: className, size = 16, ariaLabel, background = false }: Props = $props();
</script>

<svg
	class={['workstream-busy', background && 'background', className]}
	width={size}
	height={size}
	viewBox="0 0 18 18"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	{...iconLabel(ariaLabel)}
>
	<circle class="dot wave-0 orbit-0" cx="4" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-1 orbit-1" cx="9" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-2 orbit-2" cx="14" cy="4" r="1.4" fill="currentColor" />
	<circle class="dot wave-1 orbit-7" cx="4" cy="9" r="1.4" fill="currentColor" />
	{#if !background}
		<circle class="dot wave-2" cx="9" cy="9" r="1.4" fill="currentColor" />
	{/if}
	<circle class="dot wave-3 orbit-3" cx="14" cy="9" r="1.4" fill="currentColor" />
	<circle class="dot wave-2 orbit-6" cx="4" cy="14" r="1.4" fill="currentColor" />
	<circle class="dot wave-3 orbit-5" cx="9" cy="14" r="1.4" fill="currentColor" />
	<circle class="dot wave-4 orbit-4" cx="14" cy="14" r="1.4" fill="currentColor" />
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

	.background .dot {
		animation: workstream-busy-orbit 2s ease-out infinite;
		opacity: 0.24;
	}
	.background .orbit-1 {
		animation-delay: 250ms;
	}
	.background .orbit-2 {
		animation-delay: 500ms;
	}
	.background .orbit-3 {
		animation-delay: 750ms;
	}
	.background .orbit-4 {
		animation-delay: 1s;
	}
	.background .orbit-5 {
		animation-delay: 1.25s;
	}
	.background .orbit-6 {
		animation-delay: 1.5s;
	}
	.background .orbit-7 {
		animation-delay: 1.75s;
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

	@keyframes workstream-busy-orbit {
		0% {
			opacity: 0.8;
		}
		35%,
		100% {
			opacity: 0.24;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dot,
		.background .dot {
			animation: none;
			opacity: 0.52;
		}
	}
</style>
