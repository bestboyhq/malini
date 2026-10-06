<script lang="ts">
	import SensitiveFieldMask from '../sensitive/SensitiveFieldMask.svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Icon } from '../../icons';

	interface AutocompleteOption {
		value: string;
		label: string;
		hint?: string;
	}

	interface Props {
		values?: string[];
		options: AutocompleteOption[];
		label?: string;
		ariaLabel?: string;
		hint?: string;
		id?: string;
		name?: string;
		placeholder?: string;
		disabled?: boolean;
		invalid?: boolean;
		allowFreeText?: boolean;
		maxChips?: number;
		class?: ClassValue;
		onchange?: (values: string[]) => void;
	}

	let {
		values = $bindable([]),
		options,
		label,
		ariaLabel,
		hint,
		id,
		name,
		placeholder = 'Type to search…',
		disabled = false,
		invalid = false,
		allowFreeText = false,
		maxChips,
		class: className,
		onchange,
	}: Props = $props();

	const uid = $props.id();
	const inputId = $derived(id ?? `${uid}-input`);
	const listboxId = `${uid}-listbox`;
	const hintId = `${uid}-hint`;

	let inputEl: HTMLInputElement | null = $state(null);
	let query: string = $state('');
	let activeIndex: number = $state(-1);
	let menuOpen: boolean = $state(false);

	const filteredOptions = $derived(
		options
			.filter((option) => !values.includes(option.value))
			.filter((option) => {
				if (!query.trim()) {
					return true;
				}

				const needle = query.trim().toLowerCase();
				return (
					option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)
				);
			})
			.slice(0, 20),
	);

	const canAdd = $derived(maxChips === undefined || values.length < maxChips);

	const listboxVisible = $derived(menuOpen && filteredOptions.length > 0 && !disabled);
	const activeOptionId = $derived(
		listboxVisible && activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined,
	);

	function commitValue(value: string): void {
		if (!canAdd) {
			return;
		}

		const trimmed = value.trim();
		if (!trimmed || values.includes(trimmed)) {
			return;
		}

		values = [...values, trimmed];
		query = '';
		activeIndex = -1;
		onchange?.(values);
	}

	function removeValue(value: string): void {
		values = values.filter((entry) => entry !== value);
		onchange?.(values);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			menuOpen = true;
			activeIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, -1);
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();

			const highlighted = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
			if (highlighted) {
				commitValue(highlighted.value);
				return;
			}

			if (allowFreeText && query.trim()) {
				commitValue(query);
			}

			return;
		}

		if (event.key === 'Backspace' && !query && values.length > 0) {
			event.preventDefault();
			const next = values.slice(0, -1);
			values = next;
			onchange?.(next);
			return;
		}

		if (event.key === 'Escape') {
			menuOpen = false;
			activeIndex = -1;
			return;
		}
	}

	function onInputFocus(): void {
		menuOpen = true;
	}

	function onInputBlur(): void {
		setTimeout(() => {
			menuOpen = false;
		}, 120);
	}

	function getOptionLabel(value: string): string {
		const match = options.find((option) => option.value === value);
		return match ? match.label : value;
	}

	function onOptionClick(option: AutocompleteOption): void {
		commitValue(option.value);
		inputEl?.focus();
	}
</script>

<div class={['relative grid gap-1.5', className]}>
	{#if label}
		<label for={inputId} class="text-fg-secondary text-sm font-medium">{label}</label>
	{/if}

	<div
		class={[
			'border-surface-input-border bg-surface-input focus-within:border-border-default focus-within:ring-border-default/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors focus-within:ring-2',
			{
				'border-error-content focus-within:border-error-content focus-within:ring-error-content/20':
					invalid,
				'bg-surface-50 cursor-not-allowed opacity-65': disabled,
			},
		]}
		role="presentation"
		onclick={() => inputEl?.focus()}
	>
		{#each values as value (value)}
			<span
				class="border-chip-border bg-chip text-fg-secondary inline-flex items-center gap-1 rounded-full border-[0.5px] px-2 py-0.5 text-xs"
			>
				<span>{getOptionLabel(value)}</span>
				<button
					type="button"
					{disabled}
					class="text-fg-tertiary hover:bg-chip-hover hover:text-fg-default cursor-pointer rounded-full p-0.5 transition-colors"
					aria-label={`Remove ${getOptionLabel(value)}`}
					onclick={(event) => {
						event.stopPropagation();
						removeValue(value);
					}}
				>
					<Icon name="close" size={10} />
				</button>
			</span>
		{/each}

		<span class="relative grid min-w-32 flex-1">
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				role="combobox"
				id={inputId}
				{name}
				{placeholder}
				{disabled}
				aria-autocomplete="list"
				aria-expanded={listboxVisible}
				aria-controls={listboxVisible ? listboxId : undefined}
				aria-activedescendant={activeOptionId}
				aria-label={label ? undefined : ariaLabel}
				aria-invalid={invalid}
				aria-describedby={hint ? hintId : undefined}
				class="text-fg-default placeholder:text-fg-placeholder w-full bg-transparent text-sm outline-none disabled:cursor-not-allowed"
				onkeydown={onKeydown}
				onfocus={onInputFocus}
				onblur={onInputBlur}
			/>
			<SensitiveFieldMask field={inputEl ?? null} value={query} />
		</span>
	</div>

	{#if listboxVisible}
		<div
			id={listboxId}
			class="border-surface-elevated-border bg-surface-elevated shadow-popup absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border-[0.5px] p-1.5"
			role="listbox"
		>
			{#each filteredOptions as option, index (option.value)}
				<button
					type="button"
					role="option"
					id={`${uid}-option-${index}`}
					aria-selected={activeIndex === index}
					class={[
						'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors outline-none',
						activeIndex === index
							? 'bg-surface-elevated-selected text-fg-default'
							: 'text-fg-secondary hover:bg-surface-elevated-hover hover:text-fg-default',
					]}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => onOptionClick(option)}
				>
					<span class="truncate">{option.label}</span>
					{#if option.hint}
						<span class="text-fg-tertiary shrink-0 text-xs">{option.hint}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if hint}
		<span id={hintId} class={['text-xs', invalid ? 'text-error-content' : 'text-fg-tertiary']}>
			{hint}
		</span>
	{/if}
</div>
