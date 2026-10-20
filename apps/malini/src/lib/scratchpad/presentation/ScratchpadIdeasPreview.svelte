<script lang="ts">
	import { onMount } from 'svelte';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { loadScratchpadCommand } from '$lib/scratchpad/application/commands/load-scratchpad.command';
	import { scratchpadQuery } from '$lib/scratchpad/application/queries/scratchpad.query.svelte';
	import { ideasLabel } from '$lib/scratchpad/domain/scratchpad';
	import { scratchpadIdeas } from './scratchpad-editor/scratchpad-document';

	interface Props {
		repositoryFullName: string;
	}

	const PREVIEW_LIMIT = 5;

	let { repositoryFullName }: Props = $props();

	const scratchpad = $derived(scratchpadQuery.data);
	const pad = $derived(scratchpad(repositoryFullName));
	const ideas = $derived(pad.status === 'ready' ? scratchpadIdeas(pad.content) : []);
	const hidden = $derived(Math.max(0, ideas.length - PREVIEW_LIMIT));
	const summary = $derived.by(() => {
		if (pad.status === 'failed') return 'Could not read the scratchpad';
		if (pad.status === 'loading') return 'Reading the scratchpad…';
		return ideas.length > 0 ? `${ideasLabel(ideas.length)} in the scratchpad` : 'No ideas yet';
	});

	onMount(() => loadScratchpadCommand(repositoryFullName));
</script>

<section class="flex flex-col gap-2" aria-label="Scratchpad" data-testid="scratchpad-ideas-preview">
	<p class="text-fg-tertiary flex items-center gap-1.5 text-xs">
		<Icon name="note" size={12} />
		{summary}
	</p>
	{#if ideas.length > 0}
		<ul class="flex flex-col gap-2">
			{#each ideas.slice(0, PREVIEW_LIMIT) as idea, index (index)}
				<li class="flex min-w-0 flex-col gap-0.5">
					<span class="text-fg-default truncate text-sm font-medium">
						<SensitiveText text={idea.title} />
					</span>
					{#if idea.detail}
						<span class="text-fg-secondary line-clamp-2 text-xs leading-relaxed">
							<SensitiveText text={idea.detail} />
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if hidden > 0}
			<p class="text-fg-tertiary text-xs">and {hidden} more</p>
		{/if}
	{/if}
</section>
