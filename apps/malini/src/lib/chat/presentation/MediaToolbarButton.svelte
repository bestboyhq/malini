<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';

	interface Props {
		tooltip: string;
		label?: string;
		active?: boolean;
		pressed?: boolean;
		square?: boolean;
		disabled?: boolean;
		children: Snippet;
		onclick: () => void;
	}

	let {
		tooltip,
		label,
		active = false,
		pressed,
		square = false,
		disabled = false,
		children,
		onclick,
	}: Props = $props();
</script>

<Tooltip content={tooltip} placement="top">
	<Button
		variant="ghost"
		size="auto"
		{active}
		{disabled}
		{...pressed === undefined ? {} : { ariaPressed: pressed }}
		{...label ? { ariaLabel: label } : {}}
		class={[
			'h-7 gap-1.5 rounded-md text-xs font-normal',
			square ? 'w-7 justify-center px-0' : 'px-2',
			active ? 'text-fg-default' : 'text-fg-tertiary hover:text-fg-secondary',
		]}
		{onclick}
	>
		{@render children()}
	</Button>
</Tooltip>
