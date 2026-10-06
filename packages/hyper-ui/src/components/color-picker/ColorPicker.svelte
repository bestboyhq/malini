<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { isValidHex, normalizeHex } from './hex';

	interface Props {
		value?: string;
		label?: string;
		swatches?: string[];
		disabled?: boolean;
		class?: ClassValue;
		onchange?: (value: string) => void;
	}

	const DEFAULT_SWATCHES: string[] = [
		'#0F172A',
		'#475569',
		'#94A3B8',
		'#EF4444',
		'#F97316',
		'#F59E0B',
		'#84CC16',
		'#10B981',
		'#06B6D4',
		'#3B82F6',
		'#6366F1',
		'#8B5CF6',
		'#D946EF',
		'#EC4899',
	];

	let {
		value = $bindable('#3B82F6'),
		label,
		swatches = DEFAULT_SWATCHES,
		disabled = false,
		class: className,
		onchange,
	}: Props = $props();

	const normalizedSwatches = $derived(swatches.map((color) => color.toUpperCase()));
	const normalizedValue = $derived((value || '').toUpperCase());

	let draft: string = $state(normalizeHex(value ?? ''));
	let committed: string = $state(normalizeHex(value ?? ''));

	$effect(() => {
		if (normalizedValue !== committed) {
			committed = normalizedValue;
			draft = normalizedValue;
		}
	});

	function commit(next: string): void {
		committed = next;
		value = next;
		onchange?.(next);
	}

	function selectSwatch(color: string): void {
		if (disabled) {
			return;
		}

		draft = color;
		commit(color);
	}

	function onHexInput(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const next = normalizeHex(event.currentTarget.value.trim());
		draft = next;

		if (isValidHex(next)) {
			commit(next);
		}
	}

	function onHexBlur(): void {
		if (!isValidHex(draft)) {
			draft = normalizedValue;
		}
	}
</script>

<div class={['grid gap-2', className]}>
	{#if label}
		<span class="text-fg-secondary text-sm font-medium">{label}</span>
	{/if}

	<div
		class="border-surface-input-border bg-surface-input grid grid-cols-7 gap-1.5 rounded-md border p-2"
		role="radiogroup"
		aria-label={label ?? 'Color swatches'}
	>
		{#each normalizedSwatches as swatch (swatch)}
			<button
				type="button"
				role="radio"
				aria-checked={normalizedValue === swatch}
				aria-label={swatch}
				{disabled}
				class={[
					'border-border-subtle relative h-7 w-7 cursor-pointer rounded-md border transition-transform duration-150',
					'focus-visible:ring-border-default/50 hover:scale-105 focus-visible:ring-2',
					{
						'ring-border-default/50 ring-2': normalizedValue === swatch,
						'cursor-not-allowed opacity-40': disabled,
					},
				]}
				style:background-color={swatch}
				onclick={() => selectSwatch(swatch)}
			></button>
		{/each}
	</div>

	<div class="flex items-center gap-2">
		<span
			class="border-surface-input-border h-8 w-8 shrink-0 rounded-md border"
			style:background-color={isValidHex(normalizedValue) ? normalizedValue : 'transparent'}
			aria-hidden="true"
		></span>
		<input
			type="text"
			bind:value={draft}
			maxlength={7}
			{disabled}
			aria-label="Hex color"
			aria-invalid={!isValidHex(draft)}
			class="border-surface-input-border bg-surface-input text-fg-default focus:border-border-default focus:ring-border-default/50 disabled:bg-surface-50 disabled:text-fg-disabled h-8 flex-1 rounded-md border px-2 font-mono text-xs uppercase transition-colors focus:ring-2 disabled:cursor-not-allowed"
			oninput={onHexInput}
			onblur={onHexBlur}
		/>
	</div>
</div>
