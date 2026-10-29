<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import {
		focusLeadDecisionCommand,
		viewLeadDecisionCommand,
	} from '$lib/chat/application/commands/focus-lead-decision.command';
	import { leadDecisionsQuery } from '$lib/chat/application/queries/lead-decisions.query.svelte';
	import WorkstreamMedia from './WorkstreamMedia.svelte';

	interface Props {
		sessionId: string;
	}

	let { sessionId }: Props = $props();

	const decisions = $derived(leadDecisionsQuery.data(sessionId));
	const open = $derived(decisions.filter((decision) => !decision.answer));
	const decided = $derived([...decisions.filter((decision) => decision.answer)].reverse());
	const focusedId = $derived(leadDecisionsQuery.focus.focusedId);
</script>

{#if decisions.length > 0}
	<section class="flex flex-col" aria-label="Your decisions" data-testid="lead-decisions">
		<h3 class="text-fg-tertiary flex items-center gap-2 px-2 pt-1 pb-1.5 text-xs">
			<span class="text-fg-default font-medium">Your decisions</span>
			<span class="ml-auto">{open.length > 0 ? `${open.length} open` : 'all answered'}</span>
		</h3>
		<ul class="flex flex-col">
			{#each open as decision (decision.id)}
				<li>
					<Button
						bare
						ariaLabel={`${decision.topic}, waiting for you`}
						data-active={decision.id === focusedId ? 'true' : undefined}
						class="hover:bg-surface-50-hover data-[active=true]:bg-surface-50-hover flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-xs"
						onclick={() => focusLeadDecisionCommand(decision.id)}
					>
						<span class="grid size-3.5 shrink-0 place-items-center" aria-hidden="true">
							<span class="bg-brand-icon size-1.5 rounded-full"></span>
						</span>
						<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
							{decision.topic}
						</span>
						<span class="text-fg-tertiary shrink-0">waiting</span>
					</Button>
				</li>
			{/each}
			{#each decided as decision (decision.id)}
				{@const answer = decision.answer}
				{@const option = decision.options[answer?.option ?? 0]}
				<li>
					<Button
						bare
						ariaLabel={`${decision.topic}: ${option?.label ?? ''}, ${answer?.by === 'lead' ? 'decided by the lead' : 'decided by you'}. Change it`}
						class="hover:bg-surface-50-hover flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-xs"
						onclick={() =>
							option?.picture
								? viewLeadDecisionCommand(decision.id, answer?.option ?? 0)
								: focusLeadDecisionCommand(decision.id)}
					>
						<Icon name="check" size={14} class="text-fg-tertiary shrink-0" />
						<span class="text-fg-secondary min-w-0 flex-1 truncate">{decision.topic}</span>
						{#if option?.picture}
							<span
								class="bg-surface-root outline-border-subtle block h-4 w-7 shrink-0 overflow-hidden rounded-[3px] outline-[0.5px] -outline-offset-[0.5px]"
								aria-hidden="true"
							>
								<WorkstreamMedia
									workstreamId={option.picture.workstreamId}
									src={option.picture.path}
									label={option.label}
									size="mini"
									playing={false}
								/>
							</span>
						{/if}
						<span class="text-fg-tertiary max-w-[45%] shrink-0 truncate">
							{option?.label ?? ''}{answer?.by === 'lead' ? ' · lead' : ''}
						</span>
					</Button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
