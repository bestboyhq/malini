<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AriaRole, ClassValue } from 'svelte/elements';
	import LoadingCircle from '../loading-circle/LoadingCircle.svelte';

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
		children?: Snippet;
		leading?: Snippet;
		trailing?: Snippet;
		href?: string;
		type?: ButtonType;
		variant?: ButtonVariant;
		size?: ButtonSize;
		radius?: ButtonRadius;
		disabled?: boolean;
		loading?: boolean;
		dimmed?: boolean;
		active?: boolean;
		bordered?: boolean;
		iconOnly?: boolean;
		bare?: boolean;
		title?: string;
		id?: string;
		ariaLabel?: string;
		ariaBusy?: boolean;
		ariaControls?: string;
		ariaDescribedby?: string;
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
		ondblclick?: (event: MouseEvent) => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		children,
		leading,
		trailing,
		href,
		type = 'button',
		variant = 'secondary',
		size = 'md',
		radius,
		disabled = false,
		loading = false,
		dimmed,
		active = false,
		bordered = false,
		iconOnly = false,
		bare = false,
		title,
		ariaLabel,
		ariaBusy,
		ariaControls,
		ariaDescribedby,
		ariaCurrent,
		ariaExpanded,
		ariaHasPopup,
		ariaPressed,
		ariaChecked,
		ariaSelected,
		ariaKeyshortcuts,
		role,
		tabindex,
		element = $bindable(null),
		class: className,
		onclick,
		onkeydown,
		ondblclick,
		...rest
	}: Props = $props();

	const variantClass: Record<ButtonVariant, string | undefined> = {
		primary: 'bg-button-primary text-button-primary-content',
		'primary-soft': 'bg-primary/10 text-primary [&_svg]:text-primary',
		secondary: 'bg-button-secondary text-fg-secondary',
		ghost: 'bg-transparent text-fg-secondary',
		danger: 'bg-error text-error-content',
		'danger-ghost': 'bg-transparent text-error-content',
		warning: 'bg-warning text-warning-content',
		inherit: 'bg-transparent',
	};

	const busyClass: Record<ButtonVariant, string | undefined> = {
		primary: 'bg-button-primary-busy text-button-primary-busy-content',
		'primary-soft': 'bg-primary/10 text-primary',
		secondary: 'bg-button-secondary-busy text-fg-default',
		ghost: 'bg-surface-150-hover text-fg-default',
		danger: 'bg-button-danger-busy text-error-content',
		'danger-ghost': 'bg-button-danger-busy text-error-content',
		warning: 'bg-warning text-warning-content',
		inherit: undefined,
	};

	const disabledClass: Record<ButtonVariant, string | undefined> = {
		primary: 'bg-button-disabled text-button-disabled-content',
		'primary-soft': 'bg-button-disabled text-button-disabled-content',
		secondary: 'bg-button-disabled text-button-disabled-content',
		ghost: 'bg-transparent text-button-disabled-content',
		danger: 'bg-button-disabled text-button-disabled-content',
		'danger-ghost': 'bg-transparent text-button-disabled-content',
		warning: 'bg-button-disabled text-button-disabled-content',
		inherit: undefined,
	};

	const interactionClass: Record<ButtonVariant, string> = {
		primary: 'hover:bg-button-primary-hover data-[active=true]:bg-button-primary-hover',
		'primary-soft': 'hover:bg-primary/15 data-[active=true]:bg-primary/15',
		secondary:
			'hover:bg-button-secondary-hover hover:text-fg-default data-[active=true]:bg-button-secondary-hover data-[active=true]:text-fg-default',
		ghost:
			'hover:bg-surface-150-hover hover:text-fg-default data-[active=true]:bg-surface-150-hover data-[active=true]:text-fg-default',
		danger: 'hover:brightness-95 data-[active=true]:brightness-95',
		'danger-ghost': 'hover:bg-error data-[active=true]:bg-error',
		warning: 'hover:brightness-95 data-[active=true]:brightness-95',
		inherit: 'hover:opacity-80 data-[active=true]:opacity-80',
	};

	const focusClass: Record<ButtonVariant, string> = {
		primary: 'focus-visible:ring-button-primary/40',
		'primary-soft': 'focus-visible:ring-button-primary/40',
		secondary: 'focus-visible:ring-button-primary/40',
		ghost: 'focus-visible:ring-button-primary/40',
		danger: 'focus-visible:ring-error-content/30',
		'danger-ghost': 'focus-visible:ring-error-content/30',
		warning: 'focus-visible:ring-warning-content/30',
		inherit: 'focus-visible:ring-border-default/50',
	};

	const sizeMetricClass: Record<ButtonSize, string | undefined> = {
		'2xs': 'h-3.5 text-3xs leading-none',
		xs: 'h-5 text-3xs',
		sm: 'h-6 text-2xs',
		md: 'h-7 text-sm',
		lg: 'h-9 text-base',
		auto: undefined,
	};

	const paddingClass: Record<ButtonSize, string | undefined> = {
		'2xs': 'px-1.5',
		xs: 'px-2',
		sm: 'px-2.5',
		md: 'px-3',
		lg: 'px-3',
		auto: undefined,
	};

	const leadingPaddingClass: Record<ButtonSize, string | undefined> = {
		'2xs': 'pl-1 pr-1.5',
		xs: 'pl-1.5 pr-2',
		sm: 'pl-2 pr-2.5',
		md: 'pl-2.5 pr-3',
		lg: 'pl-2.5 pr-3',
		auto: undefined,
	};

	const trailingPaddingClass: Record<ButtonSize, string | undefined> = {
		'2xs': 'pl-1.5 pr-1',
		xs: 'pl-2 pr-1.5',
		sm: 'pl-2.5 pr-2',
		md: 'pl-3 pr-2.5',
		lg: 'pl-3 pr-2.5',
		auto: undefined,
	};

	const flankedPaddingClass: Record<ButtonSize, string | undefined> = {
		'2xs': 'px-1',
		xs: 'px-1.5',
		sm: 'px-2',
		md: 'px-2.5',
		lg: 'px-2.5',
		auto: undefined,
	};

	const radiusClass: Record<ButtonRadius, string | undefined> = {
		md: 'rounded-md',
		full: 'rounded-full',
		none: undefined,
	};

	const spinnerSize: Record<ButtonSize, number> = {
		'2xs': 10,
		xs: 12,
		sm: 12,
		md: 14,
		lg: 16,
		auto: 14,
	};

	const pressClass = 'active:scale-[0.975] motion-reduce:active:scale-100';

	const accessibleLabel = $derived(ariaLabel ?? title);

	const dims = $derived(dimmed ?? !bare);
	const resolvedRadius = $derived(radius ?? (iconOnly ? 'full' : 'md'));

	const inert = $derived(disabled || loading);
	const busy = $derived(ariaBusy ?? (loading || undefined));

	const surfaceClass = $derived(
		disabled && dims
			? disabledClass[variant]
			: loading
				? busyClass[variant]
				: variantClass[variant],
	);

	const showsSpinner = $derived(loading && !bare);

	const semantics = $derived({
		role,
		'aria-current': ariaCurrent,
		'aria-checked': ariaChecked,
		'aria-selected': ariaSelected,
		'aria-keyshortcuts': ariaKeyshortcuts,
		'aria-pressed': ariaPressed,
		...rest,
	});

	const contentPaddingClass = $derived.by((): string | undefined => {
		if (leading && trailing) return flankedPaddingClass[size];
		if (leading) return leadingPaddingClass[size];
		if (trailing) return trailingPaddingClass[size];
		return paddingClass[size];
	});

	const skinClass = $derived(
		bare
			? undefined
			: [
					'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium outline-0 [&>svg]:shrink-0 transition-[background-color,border-color,color,filter,opacity,scale] duration-150 ease-in-out focus-visible:ring-2',
					radiusClass[resolvedRadius],
					surfaceClass,
					focusClass[variant],
					sizeMetricClass[size],
					inert ? undefined : [interactionClass[variant], pressClass],
					iconOnly ? 'aspect-square gap-0 p-0' : ['gap-1.5', contentPaddingClass],
					{
						'cursor-pointer': !inert,
						'cursor-progress': loading && !disabled,
						'cursor-not-allowed': disabled,
					},
					{
						'border-[0.5px] border-button-secondary-border focus-visible:border-button-primary':
							bordered,
					},
				],
	);
</script>

{#if href}
	<a
		bind:this={element}
		{href}
		aria-label={accessibleLabel}
		aria-busy={busy}
		aria-controls={ariaControls}
		aria-describedby={ariaDescribedby}
		aria-expanded={ariaExpanded}
		aria-haspopup={ariaHasPopup}
		aria-disabled={inert ? 'true' : undefined}
		data-hyper-button
		data-variant={variant}
		data-size={size}
		data-icon-only={iconOnly ? 'true' : undefined}
		data-bare={bare ? 'true' : undefined}
		data-active={active ? 'true' : undefined}
		data-loading={loading ? 'true' : undefined}
		tabindex={inert ? -1 : tabindex}
		class={[skinClass, { 'pointer-events-none': inert }, className]}
		{onclick}
		{onkeydown}
		{ondblclick}
		{...semantics}
	>
		{#if showsSpinner}
			<LoadingCircle size={spinnerSize[size]} />
		{:else}
			{@render leading?.()}
		{/if}
		{@render children?.()}
		{@render trailing?.()}
	</a>
{:else}
	<button
		bind:this={element}
		{type}
		disabled={inert}
		{tabindex}
		aria-label={accessibleLabel}
		aria-busy={busy}
		aria-controls={ariaControls}
		aria-describedby={ariaDescribedby}
		aria-expanded={ariaExpanded}
		aria-haspopup={ariaHasPopup}
		data-hyper-button
		data-variant={variant}
		data-size={size}
		data-icon-only={iconOnly ? 'true' : undefined}
		data-bare={bare ? 'true' : undefined}
		data-active={active ? 'true' : undefined}
		data-loading={loading ? 'true' : undefined}
		class={[skinClass, className]}
		{onclick}
		{onkeydown}
		{ondblclick}
		{...semantics}
	>
		{#if showsSpinner}
			<LoadingCircle size={spinnerSize[size]} />
		{:else}
			{@render leading?.()}
		{/if}
		{@render children?.()}
		{@render trailing?.()}
	</button>
{/if}

<style>
	:global(
		[data-hyper-button]:not([data-bare])[data-dropdown-open='true'][data-variant='ghost']:not(
				:disabled
			)
	) {
		background-color: var(--color-surface-150-hover);
		color: var(--color-fg-default);
	}

	:global(
		[data-hyper-button]:not([data-bare])[data-dropdown-open='true'][data-variant='secondary']:not(
				:disabled
			)
	) {
		background-color: var(--color-button-secondary-hover);
		color: var(--color-fg-default);
	}

	:global(
		[data-hyper-button]:not(
				[data-bare]
			)[data-dropdown-open='true'][data-variant='primary-soft']:not(:disabled)
	) {
		background-color: color-mix(in oklab, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	:global(
		[data-hyper-button]:not([data-bare])[data-dropdown-open='true'][data-variant='primary']:not(
				:disabled
			)
	) {
		background-color: var(--color-button-primary-hover);
		color: var(--color-button-primary-content);
	}

	:global(
		[data-hyper-button]:not([data-bare])[data-dropdown-open='true'][data-variant='danger']:not(
				:disabled
			),
		[data-hyper-button]:not([data-bare])[data-dropdown-open='true'][data-variant='warning']:not(
				:disabled
			)
	) {
		filter: brightness(0.95);
	}

	:global(
		[data-hyper-button]:not(
				[data-bare]
			)[data-dropdown-open='true'][data-variant='danger-ghost']:not(:disabled)
	) {
		background-color: var(--color-error);
	}
</style>
