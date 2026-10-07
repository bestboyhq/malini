<script lang="ts">
	import SensitiveFieldMask from '../sensitive/SensitiveFieldMask.svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		value?: string;
		rows?: number;
		placeholder?: string;
		disabled?: boolean;
		readonly?: boolean;
		required?: boolean;
		invalid?: boolean;
		autoGrow?: boolean;
		bare?: boolean;
		label?: string;
		ariaLabel?: string;
		hint?: string;
		id?: string;
		name?: string;
		maxlength?: number;
		class?: ClassValue;
		textareaClass?: ClassValue;
		element?: HTMLTextAreaElement | null;
		ref?: HTMLTextAreaElement | null;
		onkeydown?: (event: KeyboardEvent) => void;
		oninput?: (event: Event) => void;
		onchange?: (event: Event) => void;
		onfocus?: (event: FocusEvent) => void;
		onblur?: (event: FocusEvent) => void;
		onpaste?: (event: ClipboardEvent) => void;
		[attr: `data-${string}`]: string | undefined;
	}

	let {
		value = $bindable(''),
		rows = 3,
		placeholder,
		disabled = false,
		readonly = false,
		required = false,
		invalid = false,
		autoGrow = false,
		bare = false,
		label,
		ariaLabel,
		hint,
		id,
		name,
		maxlength,
		class: className,
		textareaClass,
		element = $bindable(null),
		ref = $bindable(null),
		onkeydown,
		oninput,
		onchange,
		onfocus,
		onblur,
		onpaste,
		...rest
	}: Props = $props();

	const unwrapped = $derived(bare && label === undefined && hint === undefined);

	let node: HTMLTextAreaElement | null = $state(null);

	$effect(() => {
		element = node;
		ref = node;
	});

	function resize(): void {
		if (!autoGrow || !node) {
			return;
		}

		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	}

	$effect(() => {
		void value;
		resize();
	});

	function handleInput(event: Event): void {
		resize();
		oninput?.(event);
	}
</script>

{#snippet control()}
	<textarea
		{id}
		{name}
		{rows}
		{placeholder}
		{disabled}
		{readonly}
		{required}
		{maxlength}
		aria-label={ariaLabel}
		aria-invalid={invalid}
		bind:value
		bind:this={node}
		class={[
			'text-fg-default placeholder:text-fg-placeholder w-full resize-none disabled:cursor-not-allowed',
			bare
				? 'border-transparent bg-transparent outline-none focus:border-transparent focus:ring-0 focus:outline-none'
				: 'border-surface-input-border bg-surface-input focus:border-border-default focus:ring-border-default/50 disabled:bg-surface-50 disabled:text-fg-disabled min-h-12 rounded-md border px-3 py-2 text-sm leading-6 transition-[color,border-color] focus:ring-2',
			{
				'border-error-content focus:border-error-content focus:ring-error-content/20':
					invalid && !bare,
			},
			textareaClass,
		]}
		{onkeydown}
		oninput={handleInput}
		{onchange}
		{onfocus}
		{onblur}
		{onpaste}
		{...rest}></textarea>
{/snippet}

{#snippet field()}
	<span class={['relative grid', unwrapped ? className : undefined]}>
		{@render control()}
		<SensitiveFieldMask field={node} value={value ?? ''} multiline />
	</span>
{/snippet}

{#if unwrapped}
	{@render field()}
{:else}
	<label class={['grid min-w-0 gap-1.5', className]}>
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
