<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { dismissRoutineSuggestionCommand } from '$lib/routines/application/commands/dismiss-routine-suggestion.command';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
	import { formatRoutineTimestamp } from './routine-copy';

	interface Props {
		suggestion: RoutineSuggestion;
		onaccept: (suggestion: RoutineSuggestion) => void;
	}

	let { suggestion, onaccept }: Props = $props();

	const actionState = $derived(routineActionStateQuery.data(suggestion.id));
	const prompts = $derived(suggestion.evidence.map(({ text }) => text));
</script>

<li
	class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
	data-testid="routine-suggestion"
	data-suggestion-id={suggestion.id}
>
	<div class="flex items-start gap-3">
		<span class="text-fg-tertiary mt-0.5 shrink-0" aria-hidden="true">
			<Icon name="sparkles" size={14} />
		</span>
		<div class="min-w-0 flex-1">
			<p class="text-fg-default text-sm font-medium">You keep asking for the same thing</p>
			<p class="text-fg-tertiary mt-0.5 text-xs">
				{prompts.length}
				{prompts.length === 1 ? 'prompt' : 'prompts'} like this since {formatRoutineTimestamp(
					suggestion.createdAt,
				)}. A routine could run it for you.
			</p>
			<ul class="mt-1.5 space-y-1">
				{#each prompts.slice(0, 3) as prompt, index (index)}
					<li class="text-fg-secondary truncate text-xs">"{prompt}"</li>
				{/each}
				{#if prompts.length > 3}
					<li class="text-fg-tertiary text-xs">and {prompts.length - 3} more</li>
				{/if}
			</ul>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<Button
				variant="secondary"
				size="2xs"
				ariaLabel="Accept this suggestion as a draft routine"
				disabled={actionState.busy}
				data-testid="routine-suggestion-accept"
				onclick={() => onaccept(suggestion)}
			>
				Accept as draft
			</Button>
			<Button
				variant="ghost"
				size="2xs"
				ariaLabel="Dismiss this suggestion"
				loading={actionState.busy}
				data-testid="routine-suggestion-dismiss"
				onclick={() => dismissRoutineSuggestionCommand(suggestion.id)}
			>
				Dismiss
			</Button>
		</div>
	</div>
	{#if actionState.error}
		<p
			class="text-error-content mt-1.5 text-xs"
			role="alert"
			data-testid="routine-suggestion-error"
		>
			{actionState.error}
		</p>
	{/if}
</li>
