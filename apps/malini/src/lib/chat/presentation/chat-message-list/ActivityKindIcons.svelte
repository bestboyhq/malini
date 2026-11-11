<script lang="ts">
	import type { ToolActionKind } from '../tool-display-name';
	import ActionKindIcon from '../ActionKindIcon.svelte';

	interface Props {
		actionKinds: readonly ToolActionKind[];
	}

	let { actionKinds }: Props = $props();
</script>

<span class="flex shrink-0 items-center gap-1" aria-hidden="true">
	{#each actionKinds as actionKind (actionKind)}
		{#if actionKind !== 'other'}
			<ActionKindIcon kind={actionKind} size={12} />
		{/if}
	{/each}
</span>
