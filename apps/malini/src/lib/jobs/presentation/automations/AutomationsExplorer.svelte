<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Select } from '$hyper-ui/components/select';
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { loadTimelineCommand } from '$lib/jobs/application/commands/load-timeline.command';
	import { timelineErrorQuery } from '$lib/jobs/application/queries/timeline-error.query.svelte';
	import { timelineQuery } from '$lib/jobs/application/queries/timeline.query.svelte';
	import {
		chainItems,
		explorer,
		isFact,
		listed,
		through,
		wireKey,
		workingAt,
		type ExplorerItem,
		type MapNode,
		type Working,
	} from '$lib/jobs/domain/explorer';
	import { PageSection } from '$hyper-ui/components/page-section';
	import ExplorerEvents from './ExplorerEvents.svelte';
	import ExplorerMap from './ExplorerMap.svelte';
	import ExplorerStrip from './ExplorerStrip.svelte';
	import { count, explorerClock, nodeLabel, nodeNote } from './explorer-copy';
	import { STRUCTURE, type Flight, type Lit } from './explorer-layout';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	let { jobs }: Props = $props();

	const WINDOWS = [
		{ value: '1', label: 'Last hour' },
		{ value: '6', label: 'Last 6 hours' },
		{ value: '24', label: 'Last 24 hours' },
	];
	const STEP_MS = 280;
	const BATCH_MS = 90_000;
	const MAX_FLIGHTS = 48;
	const LATEST = 10;
	const IDLE: Working = { turns: [], runs: [], waiting: 0 };

	let hours = $state(24);
	let everyEvent = $state(false);
	let selectedChain = $state<string | null>(null);
	let selectedNode = $state<MapNode | null>(null);
	let cursor = $state<number | null>(null);
	let playing = $state(false);
	let flights = $state<readonly Flight[]>([]);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const everyEventId = $props.id();
	const record = $derived(timelineQuery.data);
	const error = $derived(timelineErrorQuery.data);
	const map = $derived(record === null ? null : explorer(record));
	const shown = $derived(map === null ? [] : listed(map, everyEvent));
	const at = $derived(cursor ?? map?.until ?? 0);
	const working = $derived(map === null ? IDLE : workingAt(map, at));
	const chain = $derived(
		map === null || selectedChain === null ? null : chainItems(map, selectedChain),
	);
	const lit = $derived(litOf(chain, selectedNode));
	const litIds = $derived(new Set(chain?.map((item) => item.id) ?? []));
	const list = $derived(listOf());

	onMount(() => {
		loadTimelineCommand(hours);
		return () => clearTimeout(timer);
	});

	function play(steps: readonly ExplorerItem[]): void {
		let index = cursor === null ? 0 : firstAfter(steps, cursor);
		const tick = (): void => {
			const first = steps[index];
			if (first === undefined) {
				stop();
				cursor = null;
				return;
			}
			const batch: ExplorerItem[] = [];
			for (let next = steps[index]; next !== undefined && next.at - first.at <= BATCH_MS;) {
				batch.push(next);
				index += 1;
				next = steps[index];
			}
			cursor = first.at;
			if (!prefersReducedMotion.current) {
				const launched = batch
					.filter((item) => item.hops.length > 0)
					.map((item) => ({ id: `${item.id}@${first.at}`, hops: item.hops }));
				flights = [...flights, ...launched].slice(-MAX_FLIGHTS);
			}
			timer = setTimeout(tick, STEP_MS);
		};
		playing = true;
		tick();
	}

	function stop(): void {
		clearTimeout(timer);
		timer = undefined;
		playing = false;
	}

	function firstAfter(steps: readonly ExplorerItem[], time: number): number {
		const index = steps.findIndex((step) => step.at > time);
		return index === -1 ? 0 : index;
	}

	function litOf(items: readonly ExplorerItem[] | null, node: MapNode | null): Lit | null {
		if (items !== null) {
			const hops = items.flatMap((item) => item.hops);
			return {
				wires: new Set(hops.map(wireKey)),
				nodes: new Set(hops.flat()),
			};
		}
		if (node === null || map === null) return null;
		const hops = [...STRUCTURE, ...map.items.flatMap((item) => item.hops)].filter(
			([from, to]) => from === node || to === node,
		);
		return { wires: new Set(hops.map(wireKey)), nodes: new Set([node, ...hops.flat()]) };
	}

	function listOf(): Readonly<{ title: string; note: string; items: readonly ExplorerItem[] }> {
		if (map === null) return { title: 'Latest events', note: '', items: [] };
		if (chain !== null) {
			const steps = chain.filter((item) => everyEvent || isFact(item));
			const first = steps[0];
			const last = steps.at(-1);
			const places = new Set(steps.map((item) => item.workstreamId).filter((id) => id !== null));
			return {
				title: 'One chain',
				note:
					first === undefined || last === undefined
						? ''
						: [
								count(steps.length, 'step'),
								clockSpan(first.at, last.end ?? last.at),
								...(places.size === 0 ? [] : [count(places.size, 'workstream')]),
							].join(' · '),
				items: steps,
			};
		}
		const visible = shown.filter((item) => item.at <= at);
		if (selectedNode !== null) {
			const passing = new Set(through(map, selectedNode).map((item) => item.id));
			return {
				title: nodeLabel(selectedNode),
				note: nodeNote(selectedNode),
				items: visible.filter((item) => passing.has(item.id)).slice(-LATEST),
			};
		}
		return {
			title: cursor === null ? 'Latest events' : `Up to ${explorerClock(at)}`,
			note: 'pick one to follow its chain',
			items: visible.slice(-LATEST),
		};
	}

	function clockSpan(from: number, to: number): string {
		const start = explorerClock(from);
		const end = explorerClock(to);
		return start === end ? `at ${start}` : `${start} to ${end}`;
	}

	function onSelectItem(item: ExplorerItem): void {
		selectedNode = null;
		selectedChain = selectedChain === item.chainId ? null : item.chainId;
	}

	function onSelectNode(node: MapNode): void {
		selectedChain = null;
		selectedNode = selectedNode === node ? null : node;
	}

	function onSeek(time: number): void {
		if (map === null) return;
		stop();
		cursor = time >= map.until ? null : time;
	}

	function onPlay(): void {
		if (playing) {
			stop();
			return;
		}
		if (map === null) return;
		if (cursor === null) cursor = map.since;
		play(shown);
	}

	function onWindow(value: string): void {
		hours = Number(value);
		stop();
		cursor = null;
		flights = [];
		selectedChain = null;
		selectedNode = null;
		loadTimelineCommand(hours);
	}

	function onLanded(id: string): void {
		flights = flights.filter((flight) => flight.id !== id);
	}
</script>

<PageSection
	title="Explorer"
	description="How work moved through Malini. Press play to replay it, or pick an event."
	testId="automations-explorer"
	wide
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
					ariaLabel="Refresh the explorer"
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

	<Well title="Explorer" headed={false}>
		{#if map === null}
			<p class="text-fg-tertiary px-4 py-6 text-xs">Loading the explorer…</p>
		{:else}
			<div
				class="border-surface-50-border bg-surface-50 flex flex-col gap-1 rounded-xl border-[0.5px] pt-3"
			>
				<ExplorerMap
					explorer={map}
					{working}
					{at}
					{jobs}
					{lit}
					{selectedNode}
					{flights}
					onselectnode={onSelectNode}
					onlanded={onLanded}
				/>
				<div class="border-surface-50-border border-t-[0.5px]">
					<ExplorerStrip
						since={map.since}
						until={map.until}
						items={shown}
						lit={litIds}
						at={cursor}
						{playing}
						onseek={onSeek}
						onplay={onPlay}
					/>
				</div>
			</div>
		{/if}
	</Well>

	{#if map !== null}
		<Well title={list.title} headed={false}>
			<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px]">
				<ExplorerEvents
					explorer={map}
					items={list.items}
					title={list.title}
					note={list.note}
					{selectedChain}
					onselect={onSelectItem}
					onclear={selectedChain === null && selectedNode === null
						? null
						: () => {
								selectedChain = null;
								selectedNode = null;
							}}
				/>
			</div>
		</Well>
	{/if}
</PageSection>
