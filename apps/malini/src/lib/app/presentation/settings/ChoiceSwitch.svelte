<script lang="ts" generics="Choice extends string">
	import { Button } from '$hyper-ui/components/button';

	let {
		label,
		choices,
		labels,
		selected,
		fill = false,
		onchoose,
	}: {
		label: string;
		choices: readonly Choice[];
		labels: Readonly<Record<Choice, string>>;
		selected: Choice;
		fill?: boolean;
		onchoose: (choice: Choice) => void;
	} = $props();
</script>

<div
	class={[
		'bg-surface-50 border-surface-50-border gap-0.5 rounded-[9px] border-[0.5px] p-0.5',
		fill ? 'flex' : 'inline-flex',
	]}
	role="group"
	aria-label={label}
>
	{#each choices as choice (choice)}
		<Button
			size="sm"
			variant="ghost"
			class={[fill && 'flex-1']}
			active={choice === selected}
			ariaPressed={choice === selected}
			onclick={() => onchoose(choice)}
		>
			{labels[choice]}
		</Button>
	{/each}
</div>
