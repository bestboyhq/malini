<script lang="ts">
	import { untrack } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		checked: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		labelledBy?: string;
		id?: string;
		element?: HTMLButtonElement | null;
		size?: 'sm' | 'md';
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
		size = 'md',
		class: className,
		onchange,
	}: Props = $props();

	const CROSS = ['M3 3 L7 7', 'M7 3 L3 7'] as const;
	const CHECK = ['M2.2 5.3 L4.2 7.2', 'M7.8 2.9 L4.2 7.2'] as const;
	const DIM_AFTER_MS = 300;

	const strokes = $derived(checked ? CHECK : CROSS);
	let dimmed = $state(untrack(() => disabled));

	$effect(() => {
		if (!disabled) {
			dimmed = false;
			return;
		}
		const timer = setTimeout(() => (dimmed = true), DIM_AFTER_MS);
		return () => clearTimeout(timer);
	});
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
	data-dimmed={dimmed || undefined}
	data-size={size}
	class={[
		'switch focus-visible:ring-border-default/50 bg-button-secondary-border relative inline-flex shrink-0 rounded-full inset-shadow-[0_1px_2px_rgb(0_0_0/0.35)] focus-visible:ring-2',
		size === 'sm' ? 'h-4 w-7' : 'h-6 w-10',
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
		--switch-motion: 380ms cubic-bezier(0.32, 0.72, 0, 1);
		--switch-thumb: 20px;
		--switch-reach: 16px;
		--switch-give: 6px;
		--switch-glyph: 10px;
		isolation: isolate;
		cursor: pointer;
		transition: opacity 150ms ease;
	}

	.switch[data-size='sm'] {
		--switch-thumb: 12px;
		--switch-reach: 12px;
		--switch-give: 4px;
		--switch-glyph: 6px;
	}

	.switch[data-dimmed] {
		cursor: not-allowed;
		opacity: 0.4;
	}

	@property --switch-travel {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}

	@property --switch-press {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}

	.switch::before,
	.switch::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		opacity: 0;
	}

	.switch::before {
		background: var(--color-fg-default);
		transition: opacity 150ms ease;
	}

	.switch::after {
		background: linear-gradient(
			180deg,
			color-mix(in oklab, var(--color-brand), white 18%),
			var(--color-brand)
		);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			0 0 0 0.5px color-mix(in oklab, var(--color-brand) 60%, transparent);
		transition:
			opacity var(--switch-motion),
			filter 150ms ease;
	}

	.switch[aria-checked='true']::after {
		opacity: 1;
	}

	@media (hover: hover) and (pointer: fine) {
		.switch:not([data-dimmed]):hover::before {
			opacity: 0.1;
		}

		.switch:not([data-dimmed]):hover::after {
			filter: brightness(1.08);
		}
	}

	.thumb {
		--switch-stretch: calc(
			var(--switch-give) * min(1, var(--switch-press) + sin(var(--switch-travel) * 180deg))
		);
		position: absolute;
		top: 2px;
		left: 2px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: calc(var(--switch-thumb) + var(--switch-stretch));
		height: var(--switch-thumb);
		border-radius: 9999px;
		background: var(--color-grey-50);
		box-shadow:
			0 0 0 0.5px rgb(0 0 0 / 0.12),
			0 1px 1px rgb(0 0 0 / 0.18),
			0 2px 6px rgb(0 0 0 / 0.28);
		transform: translateX(
			calc(var(--switch-travel) * (var(--switch-reach) - var(--switch-stretch)))
		);
		transition:
			--switch-travel var(--switch-motion),
			--switch-press var(--switch-motion);
	}

	.switch[aria-checked='true'] .thumb {
		--switch-travel: 1;
	}

	.switch:not(:disabled):active .thumb {
		--switch-press: 1;
	}

	svg {
		width: var(--switch-glyph);
		height: var(--switch-glyph);
		overflow: visible;
	}

	path {
		fill: none;
		stroke: var(--color-grey-500);
		stroke-width: 1.9;
		stroke-linecap: round;
		transition:
			d var(--switch-motion),
			stroke var(--switch-motion);
	}

	.switch[aria-checked='true'] path {
		stroke: var(--color-brand);
	}

	@media (prefers-reduced-motion: reduce) {
		.thumb,
		path {
			transition-property: stroke;
		}
	}
</style>
