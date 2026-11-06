<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		children: Snippet;
		keepIcon?: boolean;
	}

	let { children, keepIcon = false }: Props = $props();
</script>

<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
	<span
		class={[
			'absolute inset-0 grid place-items-center transition-opacity group-hover/expand:opacity-0',
			!keepIcon && 'group-open/expand:opacity-0 group-aria-expanded/expand:opacity-0',
		]}
	>
		{@render children()}
	</span>
	<Icon
		name="plus"
		size={14}
		class="absolute inset-0 opacity-0 transition-opacity group-open/expand:hidden group-hover/expand:opacity-100 group-aria-expanded/expand:hidden"
	/>
	<Icon
		name="minus"
		size={14}
		class={[
			'absolute inset-0 opacity-0 transition-opacity',
			keepIcon
				? 'group-aria-expanded/expand:group-hover/expand:opacity-100'
				: 'group-open/expand:opacity-100 group-aria-expanded/expand:opacity-100',
		]}
	/>
</span>
