<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Icon } from '../../icons';
	import { isSelectOptionGroup, type SelectItem } from './options';

	interface Props {
		value?: string;
		options: SelectItem[];
		label?: string;
		description?: string;
		ariaLabel?: string;
		hint?: string;
		invalid?: boolean;
		id?: string;
		name?: string;
		required?: boolean;
		disabled?: boolean;
		element?: HTMLSelectElement | null;
		class?: ClassValue;
		selectClass?: ClassValue;
		onchange?: (value: string) => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		value = $bindable(''),
		options,
		label,
		description,
		ariaLabel,
		hint,
		invalid = false,
		id,
		name,
		required = false,
		disabled = false,
		element = $bindable(null),
		class: className,
		selectClass,
		onchange,
		...rest
	}: Props = $props();
</script>

<label class={['grid gap-1.5', className]}>
	{#if label}
		<span class="text-fg-secondary text-sm font-medium">{label}</span>
	{/if}
	{#if description}
		<span class="text-fg-tertiary text-xs leading-5">{description}</span>
	{/if}
	<span class="relative">
		<select
			{id}
			{name}
			{required}
			{disabled}
			aria-label={ariaLabel}
			aria-invalid={invalid}
			bind:this={element}
			bind:value
			class={[
				'border-surface-input-border bg-surface-input text-fg-default focus:border-border-default focus:ring-border-default/50 disabled:bg-surface-50 disabled:text-fg-disabled h-9 w-full cursor-pointer appearance-none rounded-md border px-3 pr-9 text-sm transition-colors focus:ring-2 disabled:cursor-not-allowed',
				{
					'border-error-content focus:border-error-content focus:ring-error-content/20': invalid,
				},
				selectClass,
			]}
			onchange={(event) => onchange?.(event.currentTarget.value)}
			{...rest}
		>
			{#each options as item (isSelectOptionGroup(item) ? `group:${item.label}` : `option:${item.value}`)}
				{#if isSelectOptionGroup(item)}
					<optgroup label={item.label} disabled={item.disabled}>
						{#each item.options as option (option.value)}
							<option value={option.value} disabled={option.disabled}>{option.label}</option>
						{/each}
					</optgroup>
				{:else}
					<option value={item.value} disabled={item.disabled}>{item.label}</option>
				{/if}
			{/each}
		</select>
		<Icon
			name="chevron-down"
			class="text-fg-tertiary pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
			size={16}
		/>
	</span>
	{#if hint}
		<span class={['text-xs', invalid ? 'text-error-content' : 'text-fg-tertiary']}>
			{hint}
		</span>
	{/if}
</label>
