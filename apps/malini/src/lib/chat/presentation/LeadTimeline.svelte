<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$hyper-ui/components/button';
	import type { LeadDecision } from '$contract/leads';
	import {
		focusLeadDecisionCommand,
		viewLeadDecisionCommand,
	} from '$lib/chat/application/commands/focus-lead-decision.command';
	import { agentInteractionStateQuery } from '$lib/chat/application/queries/agent-interaction-state.query.svelte';
	import { leadDecisionsQuery } from '$lib/chat/application/queries/lead-decisions.query.svelte';
	import { workstreamImageSourceHook } from '$lib/chat/application/hooks/workstream-image-source.hook.svelte';
	import { leadWorkQuery } from '$lib/chat/application/queries/lead-work.query.svelte';
	import { backgroundCommandsPhrase } from '$lib/chat/domain/background-work';
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import AgentInteractionCard from './AgentInteractionCard.svelte';
	import MarkdownText from './MarkdownText.svelte';
	import MediaViewer, { type ViewerItem } from './MediaViewer.svelte';
	import TimelineActor from './TimelineActor.svelte';
	import WorkstreamMedia from './WorkstreamMedia.svelte';
	import { sessionProjectorCache } from './chat-message-list/session-projectors';
	import {
		leadTimeline,
		replyParts,
		rowSummary,
		timelineRows,
		type TimelineEntry,
		type TimelineReport,
		type TimelineSent,
	} from './lead-timeline';

	interface Props {
		workstreamId: string;
		sessionId: string;
		envelopes: readonly EventEnvelope[];
		running: boolean;
		spaceBelow?: number;
		contentBelow?: boolean;
		newContentBelow?: boolean;
	}

	let {
		workstreamId,
		sessionId,
		envelopes,
		running,
		spaceBelow = 0,
		contentBelow = $bindable(false),
		newContentBelow = $bindable(false),
	}: Props = $props();

	const AT_BOTTOM_PX = 4;
	const THUMBNAILS = 4;

	const renderState = $derived(sessionProjectorCache.acquire(sessionId).render.project(envelopes));
	const decisions = $derived(leadDecisionsQuery.data(sessionId));
	const deliveryOf = $derived(leadDecisionsQuery.delivery);
	const nameOf = $derived(workstreamNameQuery.data);
	const replyImageSource = workstreamImageSourceHook(() => workstreamId);
	const working = $derived(leadWorkQuery.working(workstreamId));
	const entries = $derived(leadTimeline(renderState.runs, decisions));
	const rows = $derived(timelineRows(entries, Date.now()));
	const runningWork = $derived(running ? nowKey(entries) : null);
	const leadThinking = $derived(running && runningWork === null);
	const firstEntryKey = $derived(rows.find((row) => row.kind === 'entry')?.key ?? null);
	const firstRowKey = $derived(rows[0]?.key ?? null);
	const lastEntryKey = $derived(
		leadThinking || working.length > 0 ? null : (rows.at(-1)?.key ?? null),
	);
	const lastNowId = $derived(working.at(-1) ?? null);

	const opened = new SvelteSet<string>();
	let viewer = $state<Readonly<{
		items: readonly ViewerItem[];
		start: number;
		title: string;
	}> | null>(null);
	let scroller: HTMLElement | null = $state(null);
	let pinned = true;

	$effect(() => {
		void rows.length;
		void working.length;
		void leadThinking;
		void follow();
	});

	async function follow(): Promise<void> {
		const wasPinned = pinned;
		await tick();
		if (!scroller) return;
		if (wasPinned) {
			scroller.scrollTop = scroller.scrollHeight;
			return;
		}
		newContentBelow = true;
	}

	export function jumpToLatest(): void {
		if (!scroller) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	function onScroll(): void {
		if (!scroller) return;
		pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_BOTTOM_PX;
		contentBelow = !pinned;
		if (pinned) newContentBelow = false;
	}

	function nowKey(all: readonly TimelineEntry[]): string | null {
		const last = all.at(-1);
		if (last?.kind === 'approval') return waitsForYou(last.item) ? last.key : null;
		return last?.kind === 'work' && last.running ? last.key : null;
	}

	function waitsForYou(item: Extract<TimelineEntry, { kind: 'approval' }>['item']): boolean {
		const { status } = agentInteractionStateQuery.data({
			kind: 'approval',
			sessionId: item.sessionId,
			runId: item.runId,
			requestId: item.approvalId,
		});
		return status !== 'resolved' && status !== 'stale';
	}

	function toggle(key: string): void {
		if (opened.has(key)) opened.delete(key);
		else opened.add(key);
	}

	function lineCount(text: string): number {
		return text.split('\n').length;
	}

	function minutes(from: number | null, to: number | null): string | null {
		if (from === null || to === null) return null;
		const span = Math.round((to - from) / 60_000);
		if (span < 1) return null;
		return span < 60 ? `${span} min` : `${Math.round(span / 6) / 10} h`;
	}

	function timeOf(at: string | null): string | null {
		if (at === null) return null;
		const date = new Date(at);
		return Number.isNaN(date.getTime())
			? null
			: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	}

	function openReport(report: TimelineReport, start: number): void {
		const { workstreamId: reporter } = report;
		if (reporter === null) return;
		viewer = {
			items: report.media.map((media) => ({
				workstreamId: reporter,
				src: media.src,
				label: media.label,
			})),
			start,
			title: nameOf(reporter) ?? 'Report',
		};
	}

	function pickedLabel(decision: LeadDecision): string {
		return decision.options[decision.answer?.option ?? decision.recommended]?.label ?? '';
	}

	function sentStatus(entry: TimelineSent): 'delivered' | 'waiting' | 'failed' {
		const status = deliveryOf(entry.deliveryId)?.status;
		if (status === 'failed') return 'failed';
		if (status === 'waiting') return 'waiting';
		return status === 'delivered' || entry.delivered ? 'delivered' : 'waiting';
	}
</script>

{#snippet toggleButton(key: string, closed: string, open: string)}
	<Button
		bare
		class="text-fg-tertiary hover:text-fg-secondary decoration-border-default ml-1.5 underline underline-offset-[3px] transition-[color]"
		ariaExpanded={opened.has(key)}
		onclick={() => toggle(key)}
	>
		{opened.has(key) ? open : closed}
	</Button>
{/snippet}

{#snippet lead()}
	<span class="text-fg-default font-medium">Lead</span>
{/snippet}

{#snippet report(entry: TimelineReport)}
	{@const reporter = entry.workstreamId}
	<div data-testid="timeline-report">
		<TimelineActor workstreamId={reporter} fallback={entry.name ?? 'A workstream'} />
		{#if entry.status === 'failed'}
			<span class="text-error-content">failed its turn:</span>
		{/if}
		<MarkdownText
			text={entry.outcome ?? (entry.backgroundCommands ? 'ended its turn' : 'finished a turn')}
			mode="inline"
			class="text-fg-secondary"
		/>
		{#if entry.backgroundCommands}
			<span class="text-fg-tertiary">
				· waits on {backgroundCommandsPhrase(entry.backgroundCommands)}
			</span>
		{/if}
		{#if entry.needs}
			<span class="text-fg-tertiary">
				· asks the lead: <MarkdownText text={entry.needs} mode="inline" />
			</span>
		{/if}
		{#if reporter !== null && entry.media.length > 0}
			<div class="mt-2 grid max-w-[34rem] grid-cols-4 gap-2">
				{#each entry.media.slice(0, THUMBNAILS) as media, index (media.src)}
					<Button
						bare
						class="group/thumb flex min-w-0 cursor-zoom-in flex-col gap-1 text-left"
						ariaLabel={`See ${media.label} full size`}
						onclick={() => openReport(entry, index)}
					>
						<span
							class="bg-surface-root outline-border-subtle group-hover/thumb:outline-border-default relative block aspect-video w-full overflow-hidden rounded-md outline-[0.5px] -outline-offset-[0.5px]"
						>
							<WorkstreamMedia
								workstreamId={reporter}
								src={media.src}
								label={media.label}
								size="tile"
								playing={false}
							/>
						</span>
						<span class="text-fg-tertiary text-2xs truncate">{media.label}</span>
					</Button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet entryBody(entry: TimelineEntry)}
	{#if entry.kind === 'prompt'}
		{@const long = lineCount(entry.text) > 2 || entry.text.length > 220}
		<div class="text-fg-default font-medium">You</div>
		<div
			class="bg-surface-50 border-surface-50-border text-fg-agent-message-strong mt-1.5 rounded-xl border-[0.5px] px-3.5 py-2.5"
		>
			<div class={['prompt-text whitespace-pre-wrap', long && !opened.has(entry.key) && 'clamped']}>
				{entry.text}
			</div>
			{#if long}
				<Button
					bare
					class="text-fg-tertiary hover:text-fg-secondary mt-1 text-xs transition-[color]"
					ariaExpanded={opened.has(entry.key)}
					onclick={() => toggle(entry.key)}
				>
					{opened.has(entry.key)
						? 'Show less'
						: lineCount(entry.text) > 1
							? `Show all · ${lineCount(entry.text)} lines`
							: 'Show all'}
				</Button>
			{/if}
		</div>
	{:else if entry.kind === 'reports'}
		<div class="flex flex-col gap-2">
			{#each entry.reports as reported (reported.key)}
				{@render report(reported)}
			{/each}
		</div>
	{:else if entry.kind === 'notice'}
		<span class="text-fg-tertiary">
			Malini told the lead: <MarkdownText text={rowSummary(entry.text)} mode="inline" />
		</span>
	{:else if entry.kind === 'work'}
		{@const span = minutes(entry.at, entry.endAt)}
		{@render lead()}
		<span class="text-fg-secondary">
			{entry.verb} · {entry.steps.length}
			{entry.steps.length === 1 ? 'step' : 'steps'}{span ? ` · ${span}` : ''}
		</span>
		{@render toggleButton(entry.key, 'Show work', 'Hide work')}
		{#if opened.has(entry.key)}
			<ol
				class="bg-surface-50 text-fg-tertiary mt-1.5 flex flex-col gap-0.5 rounded-lg px-3 py-2 font-mono text-xs leading-5"
			>
				{#each entry.steps as step, index (index)}
					<li class="truncate">{step}</li>
				{/each}
			</ol>
		{/if}
	{:else if entry.kind === 'started'}
		{@render lead()}
		<span class="text-fg-secondary">started</span>
		{#each entry.workstreams as started, index (started.id)}
			{#if index > 0}<span class="text-fg-secondary">
					{index === entry.workstreams.length - 1 ? ' and ' : ', '}
				</span>{/if}<TimelineActor workstreamId={started.id} />
		{/each}
		{@render toggleButton(entry.key, 'Show message', 'Hide message')}
		{#if opened.has(entry.key)}
			<div class="mt-1.5 flex flex-col gap-2">
				{#each entry.workstreams as started (started.id)}
					<div class="bg-surface-50 rounded-lg px-3 py-2">
						<MarkdownText text={started.prompt} mode="markdown" class="text-fg-secondary text-sm" />
					</div>
				{/each}
			</div>
		{/if}
	{:else if entry.kind === 'sent'}
		{@const status = sentStatus(entry)}
		{@render lead()}
		<span class="text-fg-secondary">sent</span>
		<TimelineActor workstreamId={entry.workstreamId} fallback={entry.name} />
		<MarkdownText text={rowSummary(entry.prompt)} mode="inline" class="text-fg-secondary" />
		<span
			class={[
				status === 'delivered' && 'text-success-content',
				status === 'waiting' && 'text-fg-tertiary',
				status === 'failed' && 'text-error-content',
			]}
		>
			· {status === 'delivered'
				? 'delivered'
				: status === 'waiting'
					? 'waits for its turn to end'
					: 'not delivered'}
		</span>
		{@render toggleButton(entry.key, 'Show message', 'Hide message')}
		{#if opened.has(entry.key)}
			<div class="bg-surface-50 mt-1.5 rounded-lg px-3 py-2">
				<MarkdownText text={entry.prompt} mode="markdown" class="text-fg-secondary text-sm" />
			</div>
		{/if}
	{:else if entry.kind === 'archived'}
		{@render lead()}
		<span class="text-fg-secondary">archived</span>
		<TimelineActor workstreamId={entry.workstreamId} fallback={entry.name} />
	{:else if entry.kind === 'job'}
		{@render lead()}
		<span class="text-fg-secondary">
			ran {entry.job}{entry.workstream ? ` in ${entry.workstream}` : ''}
		</span>
	{:else if entry.kind === 'plan'}
		{@render lead()}
		<span class="text-fg-secondary">rewrote the plan every workstream reads</span>
	{:else if entry.kind === 'decided'}
		{@const answer = entry.decision.answer}
		{@const picture = entry.decision.options[answer?.option ?? 0]?.picture ?? null}
		<span class="inline-flex max-w-full items-center gap-2 align-bottom">
			{#if picture}
				<Button
					bare
					class="bg-surface-root outline-border-subtle block h-5 w-9 shrink-0 cursor-zoom-in overflow-hidden rounded-[4px] outline-[0.5px] -outline-offset-[0.5px]"
					ariaLabel={`See ${entry.decision.topic} full size, or change it`}
					onclick={() => viewLeadDecisionCommand(entry.decision.id, answer?.option ?? 0)}
				>
					<WorkstreamMedia
						workstreamId={picture.workstreamId}
						src={picture.path}
						label={pickedLabel(entry.decision)}
						size="mini"
					/>
				</Button>
			{/if}
			<span class="min-w-0">
				<span class="text-fg-default font-medium">
					{answer?.by === 'lead' ? 'Lead decided' : 'You decided'}
				</span>
				<span class="text-fg-secondary">
					{entry.decision.topic}: {pickedLabel(entry.decision)}
				</span>
				{#if answer?.reason}<span class="text-fg-tertiary italic">· “{answer.reason}”</span>{/if}
			</span>
		</span>
		<Button
			bare
			class="text-fg-tertiary hover:text-fg-secondary decoration-border-default ml-1.5 underline underline-offset-[3px] transition-[color]"
			ariaLabel={`Change ${entry.decision.topic}`}
			onclick={() => focusLeadDecisionCommand(entry.decision.id)}
		>
			Change
		</Button>
	{:else if entry.kind === 'approval'}
		<AgentInteractionCard item={entry.item} />
	{:else if entry.kind === 'reply'}
		{@const parts = replyParts(entry.text)}
		{@const open = entry.latest ? !opened.has(entry.key) : opened.has(entry.key)}
		{#if open}
			<div class="text-fg-default font-medium">Lead</div>
			<MarkdownText
				text={parts.body}
				mode="markdown"
				imagesrc={replyImageSource()}
				class="text-fg-agent-message-strong mt-1 text-sm leading-6"
			/>
			{#if !entry.latest}{@render toggleButton(entry.key, 'Show message', 'Hide message')}{/if}
		{:else}
			{@render lead()}
			<MarkdownText text={parts.summary} mode="inline" class="text-fg-secondary" />
			{@render toggleButton(entry.key, 'Show message', 'Hide message')}
		{/if}
	{:else if entry.kind === 'stopped'}
		{#if entry.terminal === 'failed'}
			<span class="text-error-content">The lead's turn failed: {rowSummary(entry.text)}</span>
		{:else if entry.terminal === 'closed'}
			<span class="text-fg-tertiary">
				Malini closed mid-turn; the lead's next turn starts fresh
			</span>
		{:else}
			<span class="text-fg-tertiary">
				Paused: {rowSummary(entry.text)}{#if timeOf(entry.resumeAt)}, goes on by itself at {timeOf(
						entry.resumeAt,
					)}{/if}
			</span>
		{/if}
	{/if}
{/snippet}

<div
	bind:this={scroller}
	class="lead-timeline min-h-0 flex-1 overflow-y-auto"
	style:padding-bottom="{spaceBelow + 16}px"
	onscroll={onScroll}
	data-testid="lead-timeline"
>
	<ol class="chat-column px-7 pt-4" aria-label="Timeline">
		{#each rows as row (row.key)}
			{#if row.kind === 'day'}
				<li
					class={[
						'row day text-fg-tertiary pt-2 pb-3 pl-[4.25rem] text-xs',
						row.key === firstRowKey && 'rail-none',
						row.key === lastEntryKey && 'rail-end',
					]}
					data-timeline-day
				>
					{row.label}
				</li>
			{:else}
				<li
					class={[
						'row grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] items-start py-1.5 transition-opacity duration-150',
						!row.entry.current && 'past',
						row.key === runningWork && 'now',
						row.entry.kind === 'prompt' && 'py-2.5',
						row.key === firstEntryKey && 'rail-start',
						row.key === lastEntryKey && 'rail-end',
					]}
					data-timeline-entry={row.entry.kind}
				>
					{#if row.key === runningWork}
						<time class="text-fg-default text-xs leading-[22px] font-medium">Now</time>
					{:else}
						<time class="text-fg-tertiary text-xs leading-[22px] tabular-nums">{row.time}</time>
					{/if}
					<span class="node mt-2 justify-self-center" aria-hidden="true"></span>
					<div class="min-w-0 pl-2.5 text-sm leading-[22px]">
						{@render entryBody(row.entry)}
					</div>
				</li>
			{/if}
		{/each}
		{#if leadThinking}
			<li
				class={[
					'row now grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] items-start py-1.5',
					working.length === 0 && 'rail-end',
				]}
				data-timeline-entry="now"
			>
				<time class="text-fg-default text-xs leading-[22px] font-medium">Now</time>
				<span class="node mt-2 justify-self-center" aria-hidden="true"></span>
				<div class="min-w-0 pl-2.5 text-sm leading-[22px]">
					<span class="text-fg-default font-medium">Lead</span>
					<span class="text-fg-secondary">is thinking</span>
				</div>
			</li>
		{/if}
		{#each working as id, index (id)}
			<li
				class={[
					'row now grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] items-start py-1.5',
					id === lastNowId && 'rail-end',
				]}
				data-timeline-entry="now"
			>
				<time class="text-fg-default text-xs leading-[22px] font-medium">
					{index === 0 && !running ? 'Now' : ''}
				</time>
				<span class="node mt-2 justify-self-center" aria-hidden="true"></span>
				<div class="min-w-0 truncate pl-2.5 text-sm leading-[22px]">
					<TimelineActor workstreamId={id} />
					<span class="text-fg-secondary">{nameOf(id) ?? 'is working'}</span>
				</div>
			</li>
		{/each}
	</ol>
</div>

{#if viewer}
	<MediaViewer
		items={viewer.items}
		start={viewer.start}
		title={viewer.title}
		onclose={() => (viewer = null)}
	/>
{/if}

<style>
	.lead-timeline {
		scrollbar-gutter: stable;
	}

	ol {
		list-style: none;
	}

	.row {
		position: relative;
	}

	.row::before {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(3rem + 0.625rem - 0.5px);
		width: 1px;
		background: var(--color-surface-150-border);
		content: '';
	}

	.row.rail-start::before {
		top: 0.875rem;
	}

	.row.rail-end::before {
		bottom: auto;
		height: 0.875rem;
	}

	.row.rail-start.rail-end::before,
	.row.rail-none::before {
		display: none;
	}

	.row.past {
		opacity: 0.5;
	}

	.row.past:hover,
	.row.past:focus-within {
		opacity: 1;
	}

	.node {
		position: relative;
		z-index: 1;
		width: 7px;
		height: 7px;
		border-radius: 9999px;
		background: var(--color-fg-quaternary);
		box-shadow: 0 0 0 4px var(--color-surface-root);
	}

	.now .node {
		background: var(--color-brand);
	}

	.now .node::after {
		position: absolute;
		inset: -4px;
		border: 1.5px solid color-mix(in oklab, var(--color-brand) 45%, transparent);
		border-radius: 9999px;
		content: '';
		animation: timeline-ring 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
	}

	@keyframes timeline-ring {
		from {
			transform: scale(0.5);
			opacity: 1;
		}

		to {
			transform: scale(1.5);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.now .node::after {
			animation: none;
			opacity: 0.5;
		}
	}

	.clamped {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.prompt-text {
		font-size: 0.875rem;
		line-height: 1.5rem;
	}
</style>
