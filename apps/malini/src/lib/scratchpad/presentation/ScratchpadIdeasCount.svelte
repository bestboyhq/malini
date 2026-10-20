<script lang="ts">
	import { onMount } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Icon } from '$hyper-ui/icons';
	import { loadScratchpadCommand } from '$lib/scratchpad/application/commands/load-scratchpad.command';
	import { scratchpadQuery } from '$lib/scratchpad/application/queries/scratchpad.query.svelte';
	import { ideasLabel } from '$lib/scratchpad/domain/scratchpad';
	import { scratchpadIdeas } from './scratchpad-editor/scratchpad-document';

	interface Props {
		repositoryFullName: string;
		descriptionId: string;
		class?: ClassValue;
	}

	let { repositoryFullName, descriptionId, class: className }: Props = $props();

	const scratchpad = $derived(scratchpadQuery.data);
	const pad = $derived(scratchpad(repositoryFullName));
	const count = $derived(pad.status === 'ready' ? scratchpadIdeas(pad.content).length : 0);

	onMount(() => loadScratchpadCommand(repositoryFullName));
</script>

{#if count > 0}
	<span
		class={[
			'text-3xs text-fg-tertiary flex items-center gap-1 font-mono font-medium tabular-nums',
			className,
		]}
		aria-hidden="true"
		data-testid="scratchpad-ideas-count"
		data-count={count}
	>
		<Icon name="note" size={12} />
		{count}
	</span>
	<span id={descriptionId} class="sr-only">{ideasLabel(count)} in the scratchpad</span>
{/if}
