<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { dismissChildQuestionCommand } from '$lib/chat/application/commands/dismiss-child-question.command';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import AgentInteractionCard from './AgentInteractionCard.svelte';
	import AgentQuestionPanel from './AgentQuestionPanel.svelte';
	import type { ChildRequestStep } from './child-request-steps';

	interface Props {
		steps: readonly ChildRequestStep[];
		onlater: () => void;
	}

	let { steps, onlater }: Props = $props();

	let index = $state(0);
	let queue: HTMLElement | null = $state(null);
	const position = $derived(Math.max(0, Math.min(index, steps.length - 1)));
	const step = $derived(steps[position]);
	const place = $derived(
		step ? (workstreamNameQuery.data(step.child.workstreamId) ?? 'another workstream') : '',
	);
	const label = $derived(step?.child.job ? `${step.child.job} job in ${place}` : place);
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		const active = document.activeElement;
		if (active && active !== document.body && !queue?.contains(active)) return;
		if (document.querySelector('[data-dropdown-portal]:not([inert]), [aria-modal="true"]')) return;
		event.preventDefault();
		onlater();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet source()}
	<div
		class="border-surface-150-border/60 flex h-10 items-center gap-1.5 border-b pr-2 pl-3.5 text-xs"
	>
		<Icon name="dot" size={13} class="text-brand-icon shrink-0" />
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium"><SensitiveText text={label} /></span>
			<span class="text-fg-tertiary">needs you</span>
		</span>
		{#if steps.length > 1}
			<nav aria-label="Requests" class="flex shrink-0 items-center gap-0.5">
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel="Previous request"
					disabled={position === 0}
					onclick={() => (index = position - 1)}
				>
					<Icon name="chevron-left" size={12} />
				</IconButton>
				<span class="text-fg-tertiary tabular-nums" data-testid="child-request-position">
					{position + 1} of {steps.length}
				</span>
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel="Next request"
					disabled={position === steps.length - 1}
					onclick={() => (index = position + 1)}
				>
					<Icon name="chevron-right" size={12} />
				</IconButton>
			</nav>
		{/if}
		{#if step}
			<Tooltip content="Open transcript" placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel="Open transcript"
					href={workstreamHref(step.child.workstreamId, { agentSessionId: step.child.sessionId })}
				>
					<Icon name="arrow-right" size={12} />
				</IconButton>
			</Tooltip>
		{/if}
		<Tooltip content="Answer later and write to this chat" placement="top">
			<Button
				variant="ghost"
				size="xs"
				class="text-fg-secondary shrink-0"
				ariaKeyshortcuts="Escape"
				onclick={onlater}
			>
				Later
			</Button>
		</Tooltip>
	</div>
{/snippet}

{#if step}
	{@const current = step}
	<section bind:this={queue} aria-label={`${label} needs you`} data-testid="child-request-queue">
		{#key current.key}
			{#if current.kind === 'approval'}
				<div
					class="chat-column relative z-20 px-4 pb-1"
					in:fly={{ y: 10 * motion, duration: 240 * motion, easing: cubicOut }}
				>
					<ComposerShell testId="child-request-shell">
						{@render source()}
						<AgentInteractionCard item={current.item} bare />
					</ComposerShell>
					<p
						class="text-2xs text-fg-tertiary flex h-6 items-center justify-end gap-1 px-3 select-none"
					>
						<kbd class="font-sans">Esc</kbd>
						to answer later
					</p>
				</div>
			{:else}
				<AgentQuestionPanel
					requests={current.requests}
					{source}
					ondismiss={() => dismissChildQuestionCommand(current.child.sessionId)}
				/>
			{/if}
		{/key}
	</section>
{/if}
