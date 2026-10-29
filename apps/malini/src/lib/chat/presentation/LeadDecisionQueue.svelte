<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { LeadDecision } from '$contract/leads';
	import { answerLeadDecisionCommand } from '$lib/chat/application/commands/answer-lead-decision.command';
	import {
		focusLeadDecisionCommand,
		viewLeadDecisionCommand,
	} from '$lib/chat/application/commands/focus-lead-decision.command';
	import WorkstreamMedia from './WorkstreamMedia.svelte';

	interface Props {
		decisions: readonly LeadDecision[];
		focusedId: string | null;
		onlater: () => void;
	}

	let { decisions, focusedId, onlater }: Props = $props();

	let queue: HTMLElement | null = $state(null);
	const focusedAt = $derived(decisions.findIndex((decision) => decision.id === focusedId));
	const position = $derived(Math.max(0, focusedAt));
	const decision = $derived(decisions[position] ?? null);
	const changing = $derived(decision?.answer !== null && decision?.answer !== undefined);
	const pictured = $derived(decision?.options.some((option) => option.picture !== null) ?? false);
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);

	function step(towards: number): void {
		const next = decisions[(position + towards + decisions.length) % decisions.length];
		if (next) focusLeadDecisionCommand(next.id);
	}

	function noteOf(current: LeadDecision, index: number): string | null {
		const note = current.options[index]?.note ?? null;
		if (index !== current.recommended) return note;
		return note ? `Recommended · ${note.charAt(0).toLowerCase()}${note.slice(1)}` : 'Recommended';
	}

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

{#if decision}
	{@const current = decision}
	<section
		bind:this={queue}
		class="chat-column relative z-20 px-4 pb-2"
		aria-label={`Decision: ${current.topic}`}
		data-testid="lead-decision-queue"
	>
		{#key current.id}
			<div in:fly={{ y: 10 * motion, duration: 240 * motion, easing: cubicOut }}>
				<ComposerShell testId="lead-decision">
					<div
						class="border-surface-150-border/60 flex h-10 items-center gap-1.5 border-b pr-2 pl-3.5 text-xs"
					>
						<Icon name="dot" size={13} class="text-brand-icon shrink-0" />
						<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
							{changing ? `Change: ${current.topic}` : current.topic}
						</span>
						{#if decisions.length > 1 && !changing}
							<nav aria-label="Decisions" class="flex shrink-0 items-center gap-0.5">
								<IconButton
									variant="ghost"
									size="xs"
									class="text-fg-tertiary"
									ariaLabel="Previous decision"
									onclick={() => step(-1)}
								>
									<Icon name="chevron-left" size={12} />
								</IconButton>
								<span class="text-fg-tertiary tabular-nums" data-testid="lead-decision-position">
									{position + 1} of {decisions.length}
								</span>
								<IconButton
									variant="ghost"
									size="xs"
									class="text-fg-tertiary"
									ariaLabel="Next decision"
									onclick={() => step(1)}
								>
									<Icon name="chevron-right" size={12} />
								</IconButton>
							</nav>
						{/if}
						<Tooltip content="Decide later and write to the lead" placement="top">
							<Button
								variant="ghost"
								size="xs"
								class="text-fg-secondary shrink-0"
								ariaKeyshortcuts="Escape"
								onclick={onlater}
							>
								{changing ? 'Cancel' : 'Later'}
							</Button>
						</Tooltip>
					</div>
					<div class="flex flex-col gap-3 px-3.5 pt-3 pb-3.5">
						<div>
							<p class="text-fg-default text-[15px] leading-6">{current.question}</p>
							{#if current.why}
								<p class="text-fg-tertiary text-xs leading-5">{current.why}</p>
							{/if}
						</div>
						<div
							class="grid auto-cols-fr grid-flow-col gap-2.5"
							role="group"
							aria-label={`Options for ${current.topic}`}
						>
							{#each current.options as option, index (index)}
								{@const picked = current.answer?.option === index}
								{@const note = noteOf(current, index)}
								<div class="group/tile relative min-w-0">
									<Button
										bare
										ariaLabel={`Choose ${option.label}`}
										ariaPressed={picked}
										class={[
											'bg-surface-100 hover:bg-surface-100-hover border-surface-100-border flex h-full w-full flex-col gap-2 rounded-xl border p-1.5 pb-2.5 text-left',
											(index === current.recommended || picked) && 'ring-border-default ring-1',
										]}
										onclick={() => answerLeadDecisionCommand(current.id, index, '')}
									>
										{#if pictured}
											<span
												class="bg-surface-root outline-border-subtle relative block h-24 w-full overflow-hidden rounded-lg outline-[0.5px] -outline-offset-[0.5px]"
											>
												{#if option.picture}
													<WorkstreamMedia
														workstreamId={option.picture.workstreamId}
														src={option.picture.path}
														label={option.label}
														size="tile"
														playing={false}
													/>
												{:else}
													<span
														class="text-fg-tertiary absolute inset-0 grid place-items-center px-4 text-center text-sm leading-5"
														aria-hidden="true"
													>
														{option.label}
													</span>
												{/if}
											</span>
										{/if}
										<span class="flex min-w-0 flex-col gap-0.5 px-1.5">
											<span class="text-fg-default truncate text-sm leading-5">{option.label}</span>
											{#if note}
												<span class="text-fg-tertiary truncate text-xs leading-4">{note}</span>
											{/if}
										</span>
										{#if picked}
											<span
												class="bg-surface-elevated text-fg-default absolute top-3 left-3 rounded-md px-1.5 text-[11px] leading-5"
											>
												Picked
											</span>
										{/if}
									</Button>
									{#if option.picture}
										<Tooltip content="See it full size" placement="top">
											<IconButton
												variant="secondary"
												size="xs"
												ariaLabel={`See ${option.label} full size`}
												class="absolute top-3 right-3 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100"
												onclick={() => viewLeadDecisionCommand(current.id, index)}
											>
												<Icon name="maximize" size={12} />
											</IconButton>
										</Tooltip>
									{/if}
								</div>
							{/each}
						</div>
						{#if current.meanwhile && !changing}
							<p class="text-fg-tertiary flex items-center gap-1.5 text-xs">
								<Icon name="refresh" size={12} class="shrink-0" />
								<span class="truncate">{current.meanwhile}</span>
							</p>
						{/if}
					</div>
				</ComposerShell>
			</div>
		{/key}
	</section>
{/if}
