<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { THEME_MODES, type ThemeMode } from '$lib/app/domain/appearance';

	interface Props {
		mode: ThemeMode;
		onchoose: (mode: ThemeMode) => void;
	}

	let { mode, onchoose }: Props = $props();

	const LABELS: Readonly<Record<ThemeMode, string>> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark',
	};
</script>

<div
	class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
	role="group"
	aria-label="Theme"
>
	{#each THEME_MODES as option (option)}
		<Button
			size="sm"
			variant="ghost"
			active={option === mode}
			ariaPressed={option === mode}
			onclick={() => onchoose(option)}
		>
			{LABELS[option]}
		</Button>
	{/each}
</div>
