<script lang="ts" generics="Choice extends string">
	import { Button } from '$hyper-ui/components/button';

	let {
		label,
		choices,
		labels,
		selected,
		onchoose,
	}: {
		label: string;
		choices: readonly Choice[];
		labels: Readonly<Record<Choice, string>>;
		selected: Choice;
		onchoose: (choice: Choice) => void;
	} = $props();
</script>

<div
	class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
	role="group"
	aria-label={label}
>
	{#each choices as choice (choice)}
		<Button
			size="sm"
			variant="ghost"
			active={choice === selected}
			ariaPressed={choice === selected}
			onclick={() => onchoose(choice)}
		>
			{labels[choice]}
		</Button>
	{/each}
</div>
