<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import type { ToolActionKind } from './tool-display-name';

	interface Props {
		kind: ToolActionKind | null;
		size: number;
	}

	let { kind, size }: Props = $props();
</script>

{#if kind === 'edit'}
	<Icon name="pencil" size={size - 1} class="shrink-0" />
{:else if kind === 'command'}
	<Icon name="terminal" {size} class="shrink-0" />
{:else if kind === 'read'}
	<Icon name="note" {size} class="shrink-0" />
{:else if kind === 'search'}
	<Icon name="search" {size} class="shrink-0" />
{:else}
	<Icon name="wrench" {size} class="shrink-0" />
{/if}
