<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import type { ToolActionKind } from '../tool-display-name';

	interface Props {
		actionKinds: readonly ToolActionKind[];
	}

	let { actionKinds }: Props = $props();
</script>

<span class="flex shrink-0 items-center gap-1" aria-hidden="true">
	{#each actionKinds as actionKind (actionKind)}
		{#if actionKind === 'edit'}
			<Icon name="pencil" class="shrink-0" size={12} />
		{:else if actionKind === 'command'}
			<Icon name="terminal" size={12} class="shrink-0" />
		{:else if actionKind === 'read'}
			<Icon name="note" size={12} class="shrink-0" />
		{:else if actionKind === 'search'}
			<Icon name="search" size={12} class="shrink-0" />
		{/if}
	{/each}
</span>
