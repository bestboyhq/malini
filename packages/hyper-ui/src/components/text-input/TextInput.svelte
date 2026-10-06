<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue, HTMLInputAttributes } from 'svelte/elements';
	import SensitiveFieldMask from '../sensitive/SensitiveFieldMask.svelte';

	type InputType =
		'date' | 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'time' | 'url';
	type InputSize = 'xs' | 'sm' | 'md' | 'auto';

	interface Props {
		value?: string | number;
		type?: InputType;
		id?: string;
		name?: string;
		placeholder?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		maxlength?: number;
		min?: number | string;
		max?: number | string;
		step?: number | string;
		disabled?: boolean;
		readonly?: boolean;
		required?: boolean;
		invalid?: boolean;
		size?: InputSize;
		bare?: boolean;
		label?: string;
		ariaLabel?: string;
		hint?: string;
		icon?: Snippet;
		element?: HTMLInputElement | null;
		class?: ClassValue;
		inputClass?: ClassValue;
		oninput?: (event: Event) => void;
		onchange?: (event: Event) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		onfocus?: (event: FocusEvent) => void;
		onblur?: (event: FocusEvent) => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		value = $bindable(''),
		type = 'text',
		id,
		name,
		placeholder,
		autocomplete,
		maxlength,
		min,
		max,
		step,
		disabled = false,
		readonly = false,
		required = false,
		invalid = false,
		size = 'md',
		bare = false,
		label,
		ariaLabel,
		hint,
		icon,
		element = $bindable(null),
		class: className,
		inputClass,
		oninput,
		onchange,
		onkeydown,
		onfocus,
		onblur,
		...rest
	}: Props = $props();

	const sizeClass: Record<InputSize, string | undefined> = {
		xs: 'h-7 px-2.5',
		sm: 'h-8 px-2.5',
		md: 'h-9 px-3',
		auto: undefined,
	};

	const iconInsetClass: Record<InputSize, string> = {
		xs: 'left-2.5',
		sm: 'left-2.5',
		md: 'left-3',
		auto: 'left-3',
	};

	const iconPaddingClass: Record<InputSize, string> = {
		xs: 'pl-8',
		sm: 'pl-8',
		md: 'pl-9',
		auto: 'pl-9',
	};

	const unwrapped = $derived(bare && label === undefined && hint === undefined);

	const controlClass = $derived([
		'w-full text-fg-default placeholder:text-fg-placeholder disabled:cursor-not-allowed',
		bare
			? 'border-transparent bg-transparent outline-none focus:border-transparent focus:outline-none focus:ring-0'
			: [
					'rounded-md border border-surface-input-border bg-surface-input text-sm transition-colors focus:border-border-default focus:ring-2 focus:ring-border-default/50 disabled:bg-surface-50 disabled:text-fg-disabled',
					sizeClass[size],
				],
		{
			'border-error-content focus:border-error-content focus:ring-error-content/20':
				invalid && !bare,
		},
		icon ? iconPaddingClass[size] : undefined,
		inputClass,
	]);
</script>

{#snippet control()}
	<input
		{type}
		{id}
		{name}
		{placeholder}
		{autocomplete}
		{maxlength}
		{min}
		{max}
		{step}
		{disabled}
		{readonly}
		{required}
		aria-label={ariaLabel}
		aria-invalid={invalid}
		bind:this={element}
		bind:value
		class={controlClass}
		{oninput}
		{onchange}
		{onkeydown}
		{onfocus}
		{onblur}
		{...rest}
	/>
{/snippet}

{#snippet field()}
	<span class={['relative grid', unwrapped ? className : undefined]}>
		{#if icon}
			<span
				class={[
					'text-fg-tertiary pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center',
					iconInsetClass[size],
				]}
				aria-hidden="true"
			>
				{@render icon()}
			</span>
		{/if}
		{@render control()}
		<SensitiveFieldMask field={element} value={String(value ?? '')} />
	</span>
{/snippet}

{#if unwrapped}
	{@render field()}
{:else}
	<label class={['grid gap-1.5', className]}>
		{#if label}
			<span class="text-fg-secondary text-sm font-medium">{label}</span>
		{/if}

		{@render field()}

		{#if hint}
			<span class={['text-xs', invalid ? 'text-error-content' : 'text-fg-tertiary']}>
				{hint}
			</span>
		{/if}
	</label>
{/if}
