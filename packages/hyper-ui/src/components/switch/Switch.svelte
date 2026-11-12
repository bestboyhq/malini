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
	const PRESS_MS = 140;
	const DIM_AFTER_MS = 300;

	const strokes = $derived(checked ? CHECK : CROSS);
	let dimmed = $state(untrack(() => disabled));
	let pressed = $state(false);
	let pressedAt = 0;
	let release: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!disabled) {
			dimmed = false;
			return;
		}
		const timer = setTimeout(() => (dimmed = true), DIM_AFTER_MS);
		return () => clearTimeout(timer);
	});

	function press(event: PointerEvent): void {
		if (disabled || event.button !== 0) return;
		clearTimeout(release);
		pressedAt = performance.now();
		pressed = true;
	}

	function lift(): void {
		if (!pressed) return;
		const held = performance.now() - pressedAt;
		release = setTimeout(() => (pressed = false), Math.max(0, PRESS_MS - held));
	}
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
	data-pressed={pressed || undefined}
	data-dimmed={dimmed || undefined}
	class={[
		'switch focus-visible:ring-border-default/50 bg-button-secondary-border relative inline-flex h-6 w-10 shrink-0 rounded-full inset-shadow-[0_1px_2px_rgb(0_0_0/0.35)] focus-visible:ring-2',
		className,
	]}
	onpointerdown={press}
	onpointerup={lift}
	onpointercancel={lift}
	onpointerleave={lift}
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
		cursor: pointer;
		transition: opacity 150ms ease;
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

	@property --switch-stretch {
		syntax: '<length>';
		inherits: false;
		initial-value: 0px;
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
			opacity 380ms var(--switch-ease),
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
		position: absolute;
		top: 2px;
		left: 2px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: calc(20px + var(--switch-stretch));
		height: 20px;
		border-radius: 9999px;
		background: var(--color-grey-50);
		box-shadow:
			0 0 0 0.5px rgb(0 0 0 / 0.12),
			0 1px 1px rgb(0 0 0 / 0.18),
			0 2px 6px rgb(0 0 0 / 0.28);
		transform: translateX(calc(var(--switch-travel) * (16px - var(--switch-stretch))));
		transition:
			--switch-travel 380ms var(--switch-ease),
			--switch-stretch 240ms var(--switch-ease);
	}

	.switch[aria-checked='true'] .thumb {
		--switch-travel: 1;
	}

	.switch:is(:active, [data-pressed]) .thumb {
		--switch-stretch: 6px;
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

	@media (prefers-reduced-motion: reduce) {
		.thumb,
		path {
			transition-property: stroke;
		}
	}
</style>
