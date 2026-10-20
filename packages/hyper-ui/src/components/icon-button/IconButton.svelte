<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AriaRole, ClassValue } from 'svelte/elements';
	import Button from '../button/Button.svelte';

	type ButtonVariant =
		| 'primary'
		| 'primary-soft'
		| 'secondary'
		| 'ghost'
		| 'danger'
		| 'danger-ghost'
		| 'warning'
		| 'inherit';
	type ButtonSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'auto';
	type ButtonRadius = 'md' | 'full' | 'none';
	type ButtonType = 'button' | 'submit' | 'reset';

	interface Props {
		children: Snippet;
		ariaLabel: string;
		href?: string;
		type?: ButtonType;
		variant?: ButtonVariant;
		size?: ButtonSize;
		radius?: ButtonRadius;
		disabled?: boolean;
		dimmed?: boolean;
		active?: boolean;
		bordered?: boolean;
		bare?: boolean;
		ariaBusy?: boolean;
		ariaControls?: string;
		ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false';
		ariaExpanded?: boolean;
		ariaHasPopup?: 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
		ariaPressed?: boolean;
		ariaChecked?: boolean;
		ariaSelected?: boolean;
		ariaKeyshortcuts?: string;
		role?: AriaRole;
		tabindex?: number;
		element?: HTMLAnchorElement | HTMLButtonElement | null;
		class?: ClassValue;
		onclick?: (event: MouseEvent) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let { children, ariaLabel, element = $bindable(null), ...buttonProps }: Props = $props();
</script>

<Button {...buttonProps} bind:element {ariaLabel} iconOnly>
	{@render children()}
</Button>
