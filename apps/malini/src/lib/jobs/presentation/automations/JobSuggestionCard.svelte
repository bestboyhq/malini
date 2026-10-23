<script lang="ts">
	import type { JobSuggestionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { acceptJobSuggestionCommand } from '$lib/jobs/application/commands/accept-job-suggestion.command';
	import { dismissJobSuggestionCommand } from '$lib/jobs/application/commands/dismiss-job-suggestion.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';

	interface Props {
		suggestion: JobSuggestionRecord;
	}

	let { suggestion }: Props = $props();

	const SHOWN_PROMPTS = 3;
	const SINCE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

	const actionState = $derived(jobActionStateQuery.data(suggestion.id));
	const prompts = $derived(suggestion.evidence.map(({ text }) => text));
</script>

<li
	class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-4 py-3.5"
	aria-label="Suggested job"
	data-testid="job-suggestion"
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
				{prompts.length === 1 ? 'prompt' : 'prompts'} like this since {SINCE.format(
					Date.parse(suggestion.createdAt),
				)}. A job could do it for you.
			</p>
			<ul class="mt-1.5 space-y-1">
				{#each prompts.slice(0, SHOWN_PROMPTS) as prompt, index (index)}
					<li class="text-fg-secondary truncate text-xs">“{prompt}”</li>
				{/each}
				{#if prompts.length > SHOWN_PROMPTS}
					<li class="text-fg-tertiary text-xs">and {prompts.length - SHOWN_PROMPTS} more</li>
				{/if}
			</ul>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<Button
				variant="ghost"
				size="sm"
				ariaLabel="Dismiss this suggestion"
				disabled={actionState.busy}
				data-testid="job-suggestion-dismiss"
				onclick={() => dismissJobSuggestionCommand(suggestion.id)}
			>
				Dismiss
			</Button>
			<Button
				variant="secondary"
				size="sm"
				loading={actionState.busy}
				data-testid="job-suggestion-accept"
				onclick={() => acceptJobSuggestionCommand(suggestion)}
			>
				Make it a job
			</Button>
		</div>
	</div>
	{#if actionState.error}
		<p class="text-error-content mt-1.5 text-xs" role="alert">{actionState.error}</p>
	{/if}
</li>
