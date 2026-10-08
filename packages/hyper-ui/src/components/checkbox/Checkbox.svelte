<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		checked?: boolean;
		indeterminate?: boolean;
		label: string | Snippet;
		description?: string | Snippet;
		wrap?: boolean;
		disabled?: boolean;
		required?: boolean;
		invalid?: boolean;
		id?: string;
		name?: string;
		value?: string;
		element?: HTMLInputElement | null;
		class?: ClassValue;
		onchange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		indeterminate = $bindable(false),
		label,
		description,
		wrap = false,
		disabled = false,
		required = false,
		invalid = false,
		id,
		name,
		value,
		element = $bindable(null),
		class: className,
		onchange,
	}: Props = $props();

	const isSnippet = (candidate: string | Snippet): candidate is Snippet =>
		typeof candidate === 'function';
</script>

<label
	class={[
		'hover:bg-surface-150-hover flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm',
		disabled ? 'cursor-not-allowed opacity-50' : '',
		className,
	]}
>
	<input
		type="checkbox"
		{id}
		{name}
		{value}
		{disabled}
		{required}
		aria-invalid={invalid}
		bind:this={element}
		bind:checked
		bind:indeterminate
		class="border-surface-input-border text-brand accent-brand focus-visible:ring-border-default/50 mt-0.5 h-4 w-4 rounded focus-visible:ring-2"
		onchange={(event) => onchange?.(event.currentTarget.checked)}
	/>
	<span class="min-w-0">
		<span class={['text-fg-default block text-sm', wrap ? 'break-words' : 'truncate']}>
			{#if isSnippet(label)}{@render label()}{:else}{label}{/if}
		</span>
		{#if description}
			<span class={['text-fg-tertiary block text-xs', wrap ? 'break-words' : 'truncate']}>
				{#if isSnippet(description)}{@render description()}{:else}{description}{/if}
			</span>
		{/if}
	</span>
</label>
