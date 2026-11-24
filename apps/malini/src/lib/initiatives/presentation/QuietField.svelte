<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { INITIATIVE_TITLE_MAX_LENGTH } from '$contract/initiatives';

	interface Props {
		label: string;
		placeholder: string;
		shown: boolean;
		focused?: boolean;
		class?: ClassValue;
		inputClass?: ClassValue;
		onfocused?: () => void;
		onblur?: (text: string) => void;
		onescape?: () => void;
		onsubmit: (text: string) => boolean | Promise<boolean>;
	}

	let {
		label,
		placeholder,
		shown,
		focused = false,
		class: className = '',
		inputClass = 'h-8',
		onfocused,
		onblur,
		onescape,
		onsubmit,
	}: Props = $props();

	let value: string = $state('');
	let pending: boolean = $state(false);

	function grab(field: HTMLElement): void {
		field.focus();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			value = '';
			if (onescape) onescape();
			else if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
			return;
		}
		if (event.key !== 'Enter' || event.isComposing || pending) return;
		event.preventDefault();
		const text = value.trim();
		if (text) void submit(text);
	}

	async function submit(text: string): Promise<void> {
		pending = true;
		try {
			if (await onsubmit(text)) value = '';
		} finally {
			pending = false;
		}
	}
</script>

<TextInput
	bind:value
	bare
	ariaLabel={label}
	{placeholder}
	maxlength={INITIATIVE_TITLE_MAX_LENGTH}
	autocomplete="off"
	class={className}
	inputClass={[
		'min-w-0',
		inputClass,
		!shown &&
			'placeholder:opacity-0 group-hover/reveal:placeholder:opacity-100 focus:placeholder:opacity-100',
	]}
	{onkeydown}
	onfocus={() => onfocused?.()}
	onblur={() => onblur?.(value)}
	{@attach focused ? grab : null}
/>
