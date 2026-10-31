<script lang="ts">
	import { Icon, type IconName } from '$hyper-ui/icons';

	interface Props {
		icon: IconName;
		title: string;
		note?: string | undefined;
		aside: string;
	}

	let { icon, title, note, aside }: Props = $props();
</script>

<div
	class="bg-surface-100 border-surface-100-border flex min-h-10 min-w-0 items-center gap-2.5 rounded-xl border-[0.5px] px-3 py-2 shadow-xs"
>
	<span class="text-fg-tertiary grid size-5 shrink-0 place-items-center" aria-hidden="true">
		<Icon name={icon} size={14} />
	</span>
	<span class="text-fg-default min-w-0 truncate text-[12.5px] font-medium">{title}</span>
	{#if note}
		<span class="text-fg-tertiary text-3xs min-w-0 truncate font-mono">{note}</span>
	{/if}
	<span class="text-fg-tertiary ml-auto shrink-0 pl-3 text-xs">{aside}</span>
</div>
