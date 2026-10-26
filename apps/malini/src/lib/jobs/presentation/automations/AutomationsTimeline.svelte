<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Playhead } from '$hyper-ui/components/playhead';
	import { Select } from '$hyper-ui/components/select';
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { loadTimelineCommand } from '$lib/jobs/application/commands/load-timeline.command';
	import { timelineErrorQuery } from '$lib/jobs/application/queries/timeline-error.query.svelte';
	import { timelineQuery } from '$lib/jobs/application/queries/timeline.query.svelte';
	import {
		MALINI_LANE,
		chainItemIds,
		timelineLayout,
		timelineShare,
		type TimelineItem,
		type TimelineLane,
	} from '$lib/jobs/domain/timeline';
	import AutomationsSection from './AutomationsSection.svelte';
	import TimelineDetail from './TimelineDetail.svelte';
	import {
		TIMELINE_FILL,
		TIMELINE_KIND,
		timelineClock,
		timelineStatus,
		timelineTitle,
		timelineTone,
	} from './timeline-copy';

	const WINDOWS = [
		{ value: '1', label: 'Last hour' },
		{ value: '6', label: 'Last 6 hours' },
		{ value: '24', label: 'Last 24 hours' },
	];
	const REPLAY_MS = 12_000;
	const LANE_PX = 36;
	const ROW_PX: Readonly<Record<TimelineItem['kind'], number>> = {
		turn: 9,
		event: 18,
		run: 27,
		decision: 27,
	};
	const MIN_BAR = 0.004;
	const LINK_WIDTH = 1_000;

	let hours = $state(24);
	let everyEvent = $state(false);
	let selectedId = $state<string | null>(null);
	let cursor = $state<number | null>(null);
	let playing = $state(false);

	const everyEventId = $props.id();
	const record = $derived(timelineQuery.data);
	const error = $derived(timelineErrorQuery.data);
	const layout = $derived(record === null ? null : timelineLayout(record, { everyEvent }));
	const lanes = $derived(layout?.lanes ?? []);
	const at = $derived(cursor ?? layout?.until ?? 0);
	const selected = $derived(selectedId === null ? null : (layout?.items.get(selectedId) ?? null));
	const chain = $derived(
		layout === null || selectedId === null ? null : chainItemIds(layout, selectedId),
	);
	const ticks = $derived(layout === null ? [] : hourTicks(layout.since, layout.until));
	const links = $derived(layout === null || selected === null ? [] : linksOf(selected));

	onMount(() => {
		loadTimelineCommand(hours);
	});

	$effect(() => {
		if (!playing || layout === null) return;
		const { since, until } = layout;
		const startedAt = performance.now();
		const from = untrack(() => (cursor !== null && cursor < until ? cursor : since));
		let frame = requestAnimationFrame(function step(now: number): void {
			const next = from + ((now - startedAt) / REPLAY_MS) * (until - since);
			if (next >= until) {
				cursor = null;
				playing = false;
				return;
			}
			cursor = next;
			frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	function share(time: number): number {
		return layout === null ? 0 : timelineShare(layout, time);
	}

	function shown(item: TimelineItem): boolean {
		return item.start <= at;
	}

	function laneOf(laneId: string): number {
		return lanes.findIndex((lane) => lane.id === laneId);
	}

	function itemY(item: TimelineItem): number {
		return laneOf(item.laneId) * LANE_PX + ROW_PX[item.kind];
	}

	function laneItems(lane: TimelineLane): readonly TimelineItem[] {
		const visible = lane.items.filter(shown);
		return [
			...visible.filter((item) => item.end !== null),
			...visible.filter((item) => item.end === null),
		];
	}

	function linksOf(item: TimelineItem): readonly Readonly<{ key: string; d: string }>[] {
		if (layout === null) return [];
		const items = layout.items;
		const pairs = [
			...item.causes.map((cause) => [cause, item.id] as const),
			...(layout.effects.get(item.id) ?? []).map((effect) => [item.id, effect] as const),
		];
		return pairs.flatMap(([fromId, toId]) => {
			const from = items.get(fromId);
			const to = items.get(toId);
			if (!from || !to) return [];
			const x1 = share(from.end ?? from.start) * LINK_WIDTH;
			const x2 = share(to.start) * LINK_WIDTH;
			const y1 = itemY(from);
			const y2 = itemY(to);
			const bend = Math.max(12, Math.abs(x2 - x1) / 2);
			return [
				{
					key: `${fromId}>${toId}`,
					d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
				},
			];
		});
	}

	function hourTicks(since: number, until: number): readonly number[] {
		const span = until - since;
		const step = span > 12 * 60 * 60 * 1_000 ? 3 : span > 3 * 60 * 60 * 1_000 ? 1 : 0.25;
		const stepMs = step * 60 * 60 * 1_000;
		const first = Math.ceil(since / stepMs) * stepMs;
		return Array.from(
			{ length: Math.max(0, Math.floor((until - first) / stepMs) + 1) },
			(_, index) => first + index * stepMs,
		);
	}

	function laneName(lane: TimelineLane): string {
		if (lane.id === MALINI_LANE) return 'Malini';
		return lane.workstream?.name ?? 'Closed workstream';
	}

	function itemLabel(item: TimelineItem): string {
		const time =
			item.end === null
				? timelineClock(item.start)
				: `${timelineClock(item.start)} to ${timelineClock(item.end)}`;
		return `${TIMELINE_KIND[item.kind]}: ${timelineTitle(item)}, ${timelineStatus(item)}, ${time}`;
	}

	function onSelect(item: TimelineItem): void {
		selectedId = selectedId === item.id ? null : item.id;
	}

	function onSeek(value: number): void {
		if (layout === null) return;
		playing = false;
		const next = layout.since + value;
		cursor = next >= layout.until ? null : next;
	}

	function onWindow(value: string): void {
		hours = Number(value);
		cursor = null;
		playing = false;
		selectedId = null;
		loadTimelineCommand(hours);
	}

	function onReplay(): void {
		if (playing) {
			playing = false;
			return;
		}
		if (cursor === null && layout !== null) cursor = layout.since;
		playing = true;
	}
</script>

<AutomationsSection
	title="Timeline"
	description="Replay what happened in Malini, and see what caused each step."
	testId="automations-timeline"
>
	{#snippet actions()}
		<div class="flex shrink-0 items-center gap-3">
			<div class="flex items-center gap-2">
				<span id={everyEventId} class="text-fg-secondary text-xs">Every event</span>
				<Switch
					checked={everyEvent}
					labelledBy={everyEventId}
					onchange={(checked) => (everyEvent = checked)}
				/>
			</div>
			<Select ariaLabel="Time window" value={String(hours)} options={WINDOWS} onchange={onWindow} />
			<Tooltip content="Refresh" placement="top">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Refresh the timeline"
					onclick={() => loadTimelineCommand(hours)}
				>
					<Icon name="refresh" size={14} />
				</IconButton>
			</Tooltip>
		</div>
	{/snippet}

	{#if error}
		<div class="border-error-content/20 bg-error rounded-xl border-[0.5px] px-4 py-3" role="alert">
			<p class="text-error-content text-xs">{error}</p>
		</div>
	{/if}

	<Well title="Timeline" headed={false}>
		{#if layout === null}
			<p class="text-fg-tertiary px-4 py-6 text-xs">Loading the timeline…</p>
		{:else if lanes.length === 0}
			<p class="text-fg-tertiary px-4 py-6 text-xs">Nothing happened in this window.</p>
		{:else}
			<div
				class="border-surface-50-border bg-surface-50 flex flex-col gap-3 rounded-xl border-[0.5px] py-3"
			>
				<div class="flex">
					<div class="flex w-52 shrink-0 flex-col pt-5">
						{#each lanes as lane (lane.id)}
							<div
								class="flex min-w-0 flex-col justify-center pr-3"
								style:height="{LANE_PX}px"
								style:padding-left="{12 + lane.depth * 12}px"
							>
								<span class="text-fg-default truncate text-xs font-medium">{laneName(lane)}</span>
								{#if lane.workstream?.repository}
									<span class="text-fg-tertiary text-2xs truncate">
										{lane.workstream.repository}
									</span>
								{/if}
							</div>
						{/each}
					</div>
					<div class="relative min-w-0 flex-1 pr-4">
						<div class="relative h-5" aria-hidden="true">
							{#each ticks as tick (tick)}
								<span
									class="text-fg-tertiary text-2xs absolute top-0 -translate-x-1/2 tabular-nums"
									style:left="{share(tick) * 100}%"
								>
									{timelineClock(tick)}
								</span>
							{/each}
						</div>
						<div class="relative" style:height="{lanes.length * LANE_PX}px">
							{#each ticks as tick (tick)}
								<span
									class="bg-surface-50-border absolute inset-y-0 w-px"
									style:left="{share(tick) * 100}%"
									aria-hidden="true"
								></span>
							{/each}
							<ul aria-label="Lanes" class="contents">
								{#each lanes as lane, index (lane.id)}
									<li
										aria-label={laneName(lane)}
										class="absolute inset-x-0"
										style:top="{index * LANE_PX}px"
										style:height="{LANE_PX}px"
									>
										{#each laneItems(lane) as item (item.id)}
											{@const left = share(item.start)}
											{@const dim = chain !== null && !chain.has(item.id)}
											{#if item.end === null}
												<span
													class="absolute -translate-x-1/2 -translate-y-1/2"
													style:left="{left * 100}%"
													style:top="{ROW_PX[item.kind]}px"
												>
													<Button
														bare
														ariaLabel={itemLabel(item)}
														ariaPressed={selectedId === item.id}
														class="focus-visible:ring-border-default grid size-4 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2"
														data-testid="timeline-item"
														data-item-id={item.id}
														onclick={() => onSelect(item)}
													>
														<span
															class={[
																'ring-surface-50 size-2.5 ring-2 transition-transform duration-150 motion-reduce:transition-none',
																item.kind === 'decision'
																	? 'rotate-45 rounded-[2px]'
																	: 'rounded-full',
																TIMELINE_FILL[timelineTone(item)],
																selectedId === item.id && 'scale-150',
																dim && 'opacity-25',
															]}
														></span>
													</Button>
												</span>
											{:else}
												{@const right = share(Math.min(item.end, at))}
												<span
													class="absolute h-3 -translate-y-1/2"
													style:left="{left * 100}%"
													style:top="{ROW_PX[item.kind]}px"
													style:width="{Math.max(right - left, MIN_BAR) * 100}%"
												>
													<Button
														bare
														ariaLabel={itemLabel(item)}
														ariaPressed={selectedId === item.id}
														class="focus-visible:ring-border-default flex h-full w-full cursor-pointer items-center rounded-full outline-none focus-visible:ring-2"
														data-testid="timeline-item"
														data-item-id={item.id}
														onclick={() => onSelect(item)}
													>
														<span
															class={[
																'h-1.5 w-full rounded-full',
																TIMELINE_FILL[timelineTone(item)],
																selectedId === item.id && 'ring-border-default ring-2',
																dim && 'opacity-25',
															]}
														></span>
													</Button>
												</span>
											{/if}
										{/each}
									</li>
								{/each}
							</ul>
							{#if links.length > 0}
								<svg
									class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
									viewBox={`0 0 ${LINK_WIDTH} ${lanes.length * LANE_PX}`}
									preserveAspectRatio="none"
									aria-hidden="true"
								>
									{#each links as link (link.key)}
										<path
											d={link.d}
											class="stroke-border-default fill-none"
											stroke-width="1.5"
											vector-effect="non-scaling-stroke"
										/>
									{/each}
								</svg>
							{/if}
							{#if cursor !== null}
								<span
									class="bg-brand-icon absolute inset-y-0 w-px"
									style:left="{share(cursor) * 100}%"
									aria-hidden="true"
								></span>
							{/if}
						</div>
					</div>
				</div>
				<div class="flex items-center gap-3 px-4">
					<Button variant="secondary" size="sm" onclick={onReplay}>
						<Icon name={playing ? 'pause' : 'play'} size={12} />
						{playing ? 'Pause' : 'Replay'}
					</Button>
					<Playhead
						value={at - layout.since}
						max={Math.max(1, layout.until - layout.since)}
						step={1_000}
						marker={null}
						label="Time on the timeline"
						onseek={onSeek}
					/>
					<span class="text-fg-tertiary text-2xs w-12 shrink-0 text-right tabular-nums">
						{timelineClock(at)}
					</span>
				</div>
			</div>
		{/if}
	</Well>

	{#if selected && layout}
		<TimelineDetail
			item={selected}
			{layout}
			chainSize={chain?.size ?? 1}
			onselect={(id) => (selectedId = id)}
		/>
	{/if}
</AutomationsSection>
