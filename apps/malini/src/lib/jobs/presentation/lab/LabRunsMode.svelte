<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { LAB_RUN_MODES, type LabRunMode } from './lab-triggers';

	interface Props {
		value: LabRunMode;
		label: string;
		onchange: (mode: LabRunMode) => void;
	}

	let { value, label, onchange }: Props = $props();
</script>

<div
	class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
	role="radiogroup"
	aria-label={label}
>
	{#each LAB_RUN_MODES as mode (mode.value)}
		<Button
			size="sm"
			variant="ghost"
			role="radio"
			ariaChecked={mode.value === value}
			active={mode.value === value}
			onclick={() => onchange(mode.value)}
		>
			{mode.label}
		</Button>
	{/each}
</div>
