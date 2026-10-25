<script lang="ts">
	import { onMount } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { dismissChildQuestionCommand } from '$lib/chat/application/commands/dismiss-child-question.command';
	import { followChildRequestsHook } from '$lib/chat/application/hooks/follow-child-requests.hook';
	import { childRequestsQuery } from '$lib/chat/application/queries/child-requests.query.svelte';
	import type { AskingChild } from '$lib/chat/domain/child-requests';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import AgentInteractionCard from './AgentInteractionCard.svelte';
	import AgentQuestionPanel from './AgentQuestionPanel.svelte';
	import { renderInteractionItem } from './render-state';

	interface Props {
		child: AskingChild;
	}

	let { child }: Props = $props();

	const foldDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;

	onMount(() => followChildRequestsHook(child.sessionId));

	const place = $derived(workstreamNameQuery.data(child.workstreamId) ?? 'another workstream');
	const label = $derived(child.job ? `${child.job} job in ${place}` : place);
	const approvals = $derived(
		childRequestsQuery.approvals(child.sessionId).flatMap((envelope) => {
			const item = renderInteractionItem(envelope);
			return item?.kind === 'approval' ? [item] : [];
		}),
	);
	const questions = $derived(childRequestsQuery.questions(child.sessionId));
</script>

{#if approvals.length > 0 || questions.length > 0}
	<section
		aria-label={`${label} needs you`}
		class="pb-2"
		in:slide={{ duration: foldDuration, easing: quartOut }}
		data-testid="child-request"
	>
		<header class="chat-column flex h-7 items-center gap-2 px-8 text-xs">
			<Icon name="alert" size={13} class="text-warning-content shrink-0" />
			<span class="text-fg-secondary min-w-0 flex-1 truncate">
				<SensitiveText text={label} />
				<span class="text-fg-tertiary">· Needs you</span>
			</span>
			<Button
				variant="ghost"
				size="xs"
				class="text-fg-tertiary shrink-0 gap-1"
				href={workstreamHref(child.workstreamId, { agentSessionId: child.sessionId })}
			>
				Open transcript
				{#snippet trailing()}
					<Icon name="arrow-right" size={11} />
				{/snippet}
			</Button>
		</header>
		{#each approvals as item (item.key)}
			<div class="chat-column relative px-7 pt-1">
				<AgentInteractionCard {item} />
			</div>
		{/each}
		{#if questions.length > 0}
			<AgentQuestionPanel
				requests={questions}
				ondismiss={() => dismissChildQuestionCommand(child.sessionId)}
			/>
		{/if}
	</section>
{/if}
