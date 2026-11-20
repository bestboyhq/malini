<script lang="ts">
	import { untrack } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { INITIATIVE_TITLE_MAX_LENGTH } from '$contract/initiatives';

	interface Props {
		title: string;
		label: string;
		class?: ClassValue;
		onsave: (title: string) => void;
		onclose: () => void;
	}

	let { title, label, class: className, onsave, onclose }: Props = $props();

	let value: string = $state(untrack(() => title));
	let editing: boolean = $state(true);

	function grab(field: HTMLInputElement): void {
		field.focus();
		field.select();
	}

	function finish(save: boolean): void {
		if (!editing) return;
		editing = false;
		const next = value.trim();
		if (save && next && next !== title) onsave(next);
		onclose();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			finish(false);
			return;
		}
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		finish(true);
	}
</script>

<TextInput
	bind:value
	bare
	ariaLabel={label}
	maxlength={INITIATIVE_TITLE_MAX_LENGTH}
	autocomplete="off"
	class={['min-w-0 flex-1', className]}
	inputClass="h-8"
	{onkeydown}
	onblur={() => finish(true)}
	{@attach grab}
/>
