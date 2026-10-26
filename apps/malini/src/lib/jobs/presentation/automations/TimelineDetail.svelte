<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Well } from '$hyper-ui/components/well';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import type { TimelineItem, TimelineLayout } from '$lib/jobs/domain/timeline';
	import { DECIDERS } from './decision-copy';
	import {
		TIMELINE_FILL,
		TIMELINE_KIND,
		timelineClock,
		timelineStatus,
		timelineTitle,
		timelineTone,
	} from './timeline-copy';

	interface Props {
		item: TimelineItem;
		layout: TimelineLayout;
		chainSize: number;
		onselect: (id: string) => void;
	}

	let { item, layout, chainSize, onselect }: Props = $props();

	const title = $derived(timelineTitle(item));
	const causes = $derived(related(item.causes));
	const effects = $derived(related(layout.effects.get(item.id) ?? []));
	const lane = $derived(layout.lanes.find((candidate) => candidate.id === item.laneId) ?? null);
	const time = $derived(
		item.end === null
			? timelineClock(item.start)
			: `${timelineClock(item.start)} to ${timelineClock(item.end)}`,
	);
	const transcript = $derived(transcriptOf(item));

	function related(ids: readonly string[]): readonly TimelineItem[] {
		return ids.flatMap((id) => {
			const found = layout.items.get(id);
			return found ? [found] : [];
		});
	}

	function transcriptOf(entry: TimelineItem): string | null {
		if (entry.kind === 'turn') {
			return workstreamHref(entry.turn.workstreamId, { agentSessionId: entry.turn.sessionId });
		}
		if (entry.kind === 'run' && entry.run.workstreamId && entry.run.sessionId) {
			return workstreamHref(entry.run.workstreamId, { agentSessionId: entry.run.sessionId });
		}
		return null;
	}
</script>

{#snippet links(heading: string, list: readonly TimelineItem[])}
	<div class="flex flex-col gap-1">
		<h4 class="text-fg-tertiary text-2xs font-medium">{heading}</h4>
		{#if list.length === 0}
			<p class="text-fg-tertiary text-xs">Nothing in this window.</p>
		{:else}
			<ul aria-label={heading} class="flex flex-col">
				{#each list as entry (entry.id)}
					<li>
						<Button
							bare
							ariaLabel={`${TIMELINE_KIND[entry.kind]}: ${timelineTitle(entry)}`}
							class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-xs outline-none focus-visible:ring-2"
							onclick={() => onselect(entry.id)}
						>
							<span
								class={['size-2 shrink-0 rounded-full', TIMELINE_FILL[timelineTone(entry)]]}
								aria-hidden="true"
							></span>
							<span class="text-fg-tertiary text-2xs w-16 shrink-0">
								{TIMELINE_KIND[entry.kind]}
							</span>
							<span class="text-fg-default min-w-0 flex-1 truncate">
								<SensitiveText text={timelineTitle(entry)} />
							</span>
							<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums">
								{timelineClock(entry.start)}
							</span>
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/snippet}

<Well title={`${TIMELINE_KIND[item.kind]}: ${title}`} headed={false}>
	<div
		class="border-surface-50-border bg-surface-50 flex flex-col gap-4 rounded-xl border-[0.5px] px-4 py-3"
		data-testid="timeline-detail"
	>
		<div class="flex items-start gap-3">
			<span
				class={['mt-1 size-2.5 shrink-0 rounded-full', TIMELINE_FILL[timelineTone(item)]]}
				aria-hidden="true"
			></span>
			<div class="min-w-0 flex-1">
				<p class="text-fg-tertiary text-2xs">{TIMELINE_KIND[item.kind]}</p>
				<h3 class="text-fg-default text-sm font-medium"><SensitiveText text={title} /></h3>
				<p class="text-fg-tertiary text-xs tabular-nums">
					{timelineStatus(item)} · {time}
					{#if lane?.workstream}· {lane.workstream.name}{/if}
					· {chainSize}
					{chainSize === 1 ? 'thing' : 'things'} in this chain
				</p>
			</div>
			{#if transcript}
				<Button variant="secondary" size="sm" href={transcript}>Open transcript</Button>
			{/if}
		</div>

		{#if item.kind === 'decision'}
			<div class="flex flex-col gap-1">
				<h4 class="text-fg-tertiary text-2xs font-medium">What Malini saw</h4>
				<ul class="text-fg-secondary flex flex-col gap-0.5 text-xs">
					{#each item.decision.facts as fact, index (index)}
						<li><SensitiveText text={fact} /></li>
					{/each}
				</ul>
				<p class="text-fg-tertiary text-xs">
					{DECIDERS[item.decision.decidedBy]} from {item.decision.candidates.length} choices.
				</p>
			</div>
		{:else if item.kind === 'run' && item.run.detail}
			<p class="text-fg-secondary text-xs"><SensitiveText text={item.run.detail} /></p>
		{:else if item.kind === 'event'}
			<p class="text-fg-tertiary text-2xs font-mono">{item.event.channel}</p>
		{/if}

		<div class="grid grid-cols-2 gap-4">
			{@render links('Caused by', causes)}
			{@render links('Led to', effects)}
		</div>
	</div>
</Well>
