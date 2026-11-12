<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		checked: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		labelledBy?: string;
		id?: string;
		element?: HTMLButtonElement | null;
		class?: ClassValue;
		onchange: (checked: boolean) => void;
	}

	let {
		checked,
		disabled = false,
		ariaLabel,
		labelledBy,
		id,
		element = $bindable(null),
		class: className,
		onchange,
	}: Props = $props();

	const CROSS = ['M3 3 L7 7', 'M7 3 L3 7'] as const;
	const CHECK = ['M2.2 5.3 L4.2 7.2', 'M7.8 2.9 L4.2 7.2'] as const;
	const strokes = $derived(checked ? CHECK : CROSS);
</script>

<button
	type="button"
	role="switch"
	{id}
	aria-checked={checked}
	aria-label={ariaLabel}
	aria-labelledby={labelledBy}
	bind:this={element}
	{disabled}
	class={[
		'switch focus-visible:ring-border-default/50 bg-button-secondary-border relative inline-flex h-6 w-10 shrink-0 rounded-full inset-shadow-[0_1px_2px_rgb(0_0_0/0.35)] focus-visible:ring-2 disabled:opacity-40',
		disabled ? 'cursor-not-allowed' : 'cursor-pointer',
		className,
	]}
	onclick={() => onchange(!checked)}
>
	<span class="thumb">
		<svg viewBox="0 0 10 10" aria-hidden="true">
			<path d={strokes[0]} />
			<path d={strokes[1]} />
		</svg>
	</span>
</button>

<style>
	.switch {
		--switch-ease: cubic-bezier(0.32, 0.72, 0, 1);
		isolation: isolate;
	}

	.switch::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(
			180deg,
			color-mix(in oklab, var(--color-brand), white 18%),
			var(--color-brand)
		);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 0 0 0.5px color-mix(in oklab, var(--color-brand) 60%, transparent),
			0 0 14px color-mix(in oklab, var(--color-brand) 45%, transparent);
		opacity: 0;
		transition: opacity 240ms ease;
	}

	.switch[aria-checked='true']::before {
		opacity: 1;
	}

	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 9999px;
		background: var(--color-grey-50);
		box-shadow:
			0 0 0 0.5px rgb(0 0 0 / 0.12),
			0 1px 1px rgb(0 0 0 / 0.18),
			0 2px 6px rgb(0 0 0 / 0.28);
		transition:
			transform 380ms var(--switch-ease),
			width 240ms var(--switch-ease);
	}

	.switch[aria-checked='true'] .thumb {
		transform: translateX(16px);
	}

	.switch:not(:disabled):active .thumb {
		width: 26px;
	}

	.switch[aria-checked='true']:not(:disabled):active .thumb {
		transform: translateX(10px);
	}

	svg {
		width: 10px;
		height: 10px;
		overflow: visible;
	}

	path {
		fill: none;
		stroke: var(--color-grey-500);
		stroke-width: 1.9;
		stroke-linecap: round;
		transition:
			d 320ms cubic-bezier(0.45, 0, 0.25, 1),
			stroke 320ms ease;
	}

	.switch[aria-checked='true'] path {
		stroke: var(--color-brand);
	}

	@media (hover: hover) and (pointer: fine) {
		.switch:not(:disabled):hover {
			background-color: color-mix(
				in oklab,
				var(--color-button-secondary-border),
				var(--color-fg-default) 10%
			);
		}

		.switch:not(:disabled):hover::before {
			filter: brightness(1.08);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.thumb,
		path {
			transition-property: stroke;
		}
	}
</style>
