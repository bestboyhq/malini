<script lang="ts">
	import type { JobRunMode } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { RUN_MODES } from './triggers';

	interface Props {
		value: JobRunMode;
		label: string;
		disabled?: boolean;
		onchange: (mode: JobRunMode) => void;
	}

	let { value, label, disabled = false, onchange }: Props = $props();
</script>

<div
	class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
	role="radiogroup"
	aria-label={label}
>
	{#each RUN_MODES as mode (mode.value)}
		<Button
			size="sm"
			variant="ghost"
			role="radio"
			ariaChecked={mode.value === value}
			active={mode.value === value}
			{disabled}
			onclick={() => onchange(mode.value)}
		>
			{mode.label}
		</Button>
	{/each}
</div>
