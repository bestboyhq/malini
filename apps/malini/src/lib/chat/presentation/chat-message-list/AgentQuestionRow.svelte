<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { agentInteractionStateQuery } from '$lib/chat/application/queries/agent-interaction-state.query.svelte';
	import { answersFromToolOutput } from '$lib/chat/domain/agent-question-answers';
	import ExpandMark from '../ExpandMark.svelte';
	import type { RenderItem } from '../render-state';

	interface Props {
		item: Extract<RenderItem, { kind: 'question' }>;
	}

	let { item }: Props = $props();

	let open = $state(false);

	const interactionState = $derived(
		agentInteractionStateQuery.data({
			kind: 'question',
			sessionId: item.sessionId,
			runId: item.runId,
			requestId: item.questionId,
		}),
	);
	const answers = $derived(answersFromToolOutput(item.questions, item.answerOutput));
	const status = $derived(
		answers || interactionState.status === 'resolved'
			? 'answered'
			: interactionState.status === 'stale'
				? 'unanswered'
				: 'asked',
	);
	const label = $derived(
		status === 'answered' ? 'Answered' : status === 'unanswered' ? 'Not answered' : 'Asked',
	);
	const icon = $derived<IconName>(
		status === 'answered' ? 'check' : status === 'unanswered' ? 'clock' : 'question',
	);
	const subject = $derived(
		item.questions.length === 1
			? (item.questions[0]?.prompt ?? '')
			: item.questions.map((question) => question.header ?? question.prompt).join(' · '),
	);
	const summary = $derived(
		!answers
			? subject
			: answers.length === 1
				? (answers[0]?.answer ?? '')
				: answers
						.map(({ question, answer }) => `${question.header ?? question.prompt}: ${answer}`)
						.join(' · '),
	);
	const pairs = $derived(
		item.questions.map((question, index) => ({ question, answer: answers?.[index]?.answer })),
	);
</script>

<details
	class="group/expand text-fg-tertiary w-full text-sm"
	bind:open
	data-message-kind="question"
	data-testid="agent-question-row"
	data-interaction-state={status}
>
	<summary
		class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color]"
	>
		<ExpandMark>
			<Icon name={icon} size={13} />
		</ExpandMark>
		<span class="text-fg-secondary shrink-0">{label}</span>
		<span class="min-w-0 flex-1 truncate group-open/expand:invisible">
			<SensitiveText text={summary} />
		</span>
	</summary>
	{#if open}
		<dl
			class="border-surface-100-border mt-1 mb-2 ml-1.5 flex flex-col gap-2.5 border-l pl-3.5 text-xs leading-relaxed select-text"
		>
			{#each pairs as { question, answer } (question.id)}
				<div>
					<dt class="text-fg-tertiary"><SensitiveText text={question.prompt} /></dt>
					<dd class="text-fg-secondary">
						{#if answer}<SensitiveText text={answer} />{:else}<span class="text-fg-tertiary">
								—
							</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}
</details>
