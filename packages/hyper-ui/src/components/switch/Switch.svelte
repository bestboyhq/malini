<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		checked: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		labelledBy?: string;
		id?: string;
		element?: HTMLButtonElement | null;
		class?: ClassValue;
		onchange: (checked: boolean) => void;
	}

	let {
		checked,
		disabled = false,
		ariaLabel,
		labelledBy,
		id,
		element = $bindable(null),
		class: className,
		onchange,
	}: Props = $props();
</script>

<button
	type="button"
	role="switch"
	{id}
	aria-checked={checked}
	aria-label={ariaLabel}
	aria-labelledby={labelledBy}
	bind:this={element}
	{disabled}
	class={[
		'focus-visible:ring-border-default/50 relative inline-flex h-6 w-10 shrink-0 items-center rounded-full focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40',
		checked ? 'bg-brand' : 'bg-button-secondary-border',
		disabled ? 'cursor-not-allowed' : 'cursor-pointer',
		className,
	]}
	onclick={() => onchange(!checked)}
>
	<span
		class={[
			'bg-surface-150 h-5 w-5 rounded-full shadow-sm transition-transform duration-150',
			checked ? 'translate-x-[18px]' : 'translate-x-0.5',
		]}
	></span>
</button>
