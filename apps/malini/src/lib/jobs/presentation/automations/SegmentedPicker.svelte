<script lang="ts" generics="T extends string">
	import { Button } from '$hyper-ui/components/button';

	let {
		value,
		options,
		label,
		disabled = false,
		onchange,
	}: {
		value: T;
		options: readonly Readonly<{ value: T; label: string }>[];
		label: string;
		disabled?: boolean;
		onchange: (value: T) => void;
	} = $props();
</script>

<div
	class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
	role="radiogroup"
	aria-label={label}
>
	{#each options as option (option.value)}
		<Button
			size="sm"
			variant="ghost"
			role="radio"
			ariaChecked={option.value === value}
			active={option.value === value}
			{disabled}
			onclick={() => onchange(option.value)}
		>
			{option.label}
		</Button>
	{/each}
</div>
