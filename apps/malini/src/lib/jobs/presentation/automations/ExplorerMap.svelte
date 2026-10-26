<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ClassValue } from 'svelte/elements';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteMap } from 'svelte/reactivity';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import {
		EVENT_ROWS,
		LISTENERS,
		ROW_SOURCES,
		wireKey,
		type Explorer,
		type Hop,
		type MapNode,
		type WorkNode,
		type Working,
	} from '$lib/jobs/domain/explorer';
	import {
		LISTENER_LABELS,
		ROW_LOOKS,
		SOURCE_LABELS,
		count,
		explorerClock,
		listenerNote,
		nodeLabel,
	} from './explorer-copy';
	import { STRUCTURE, mapLayout, type Box, type Flight, type Lit } from './explorer-layout';

	interface Props {
		explorer: Explorer;
		working: Working;
		at: number;
		jobs: readonly JobDefinitionRecord[];
		lit: Lit | null;
		selectedNode: MapNode | null;
		flights: readonly Flight[];
		onselectnode: (node: MapNode) => void;
		onlanded: (id: string) => void;
	}

	let { explorer, working, at, jobs, lit, selectedNode, flights, onselectnode, onlanded }: Props =
		$props();

	const HOP_MS = 360;
	const FLASH_MS = 480;
	const WORKING_ROWS = 4;
	const BUSY_WIRE = 40;
	const WORK: readonly WorkNode[] = ['chats', 'jobs'];

	let width = $state(0);
	const flashes = new SvelteMap<MapNode, number>();

	const layout = $derived(mapLayout(width));
	const totalEvents = $derived(explorer.counts.get('reconciler') ?? 0);
	const you = $derived(place('you'));
	const reconciler = $derived(place('reconciler'));
	const domains = $derived([
		{
			key: 'events',
			box: layout.domains.events,
			label: `event log · ${count(totalEvents, 'event')}`,
		},
		{ key: 'work', box: layout.domains.work, label: 'work · what runs' },
	]);
	const traffic = $derived(trafficOf());
	const litRoutes = $derived(
		[...hopsByKey().entries()].flatMap(([key, hop]) => {
			const route = lit?.wires.has(key) ? layout.route(hop) : null;
			return route === null ? [] : [{ key, ...route }];
		}),
	);

	function hopsByKey(): Map<string, Hop> {
		return new Map(
			[...STRUCTURE, ...explorer.items.flatMap((item) => item.hops)].map((hop) => [
				wireKey(hop),
				hop,
			]),
		);
	}

	function trafficOf(): Readonly<Record<string, number>> {
		const totals: Record<string, number> = {};
		const add = (id: string, amount: number): void => {
			totals[id] = (totals[id] ?? 0) + amount;
		};
		EVENT_ROWS.forEach((row, index) => {
			const events = explorer.counts.get(`event:${row}`) ?? 0;
			add(`stub:${row}`, events);
			if (index > 0) add('bus', events);
		});
		add('trunk', totalEvents);
		for (const item of explorer.items) {
			if (item.kind === 'event' && item.cause !== null) add('loop', 1);
			for (const hop of item.hops) {
				if (hop[0].startsWith('event:')) continue;
				for (const id of layout.segmentsOf(hop)) add(id, 1);
			}
		}
		return totals;
	}

	function place(node: MapNode): Box {
		return layout.boxes.get(node) ?? { x: 0, y: 0, w: 0, h: 0 };
	}

	function tone(node: MapNode): ClassValue {
		const flashing = (flashes.get(node) ?? 0) > 0;
		return [
			'bg-surface-100 border-surface-100-border hover:bg-surface-100-hover flex size-full rounded-[10px] border-[0.5px] text-left transition-[box-shadow,opacity] duration-200 motion-reduce:transition-none',
			flashing ? 'ring-brand ring-2' : lit?.nodes.has(node) && 'ring-brand-icon ring-1',
			lit !== null && !lit.nodes.has(node) && 'opacity-40',
			selectedNode === node && 'ring-brand-icon ring-1',
		];
	}

	function ruleTone(node: MapNode): ClassValue {
		const flashing = (flashes.get(node) ?? 0) > 0;
		return [
			'bg-surface-50 border-surface-50-border hover:bg-surface-50-hover flex size-full flex-col justify-center rounded-lg border-[0.5px] px-2.5 text-left transition-[box-shadow,opacity] duration-200 motion-reduce:transition-none',
			flashing ? 'ring-brand ring-2' : lit?.nodes.has(node) && 'ring-brand-icon ring-1',
			lit !== null && !lit.nodes.has(node) && 'opacity-40',
			selectedNode === node && 'ring-brand-icon ring-1',
		];
	}

	function flash(node: MapNode): void {
		flashes.set(node, (flashes.get(node) ?? 0) + 1);
		setTimeout(() => {
			const left = (flashes.get(node) ?? 1) - 1;
			if (left > 0) flashes.set(node, left);
			else flashes.delete(node);
		}, FLASH_MS);
	}

	function fly(flight: Flight): Attachment<HTMLElement> {
		return (dot) => {
			let current: Animation | null = null;
			let stopped = false;
			const travel = async (): Promise<void> => {
				for (const hop of flight.hops) {
					if (stopped) return;
					if (hop === flight.hops[0]) flash(hop[0]);
					const route = layout.route(hop);
					if (route === null) {
						flash(hop[1]);
						continue;
					}
					dot.style.offsetPath = `path('${route.d}')`;
					current = dot.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
						duration: prefersReducedMotion.current ? 0 : HOP_MS,
						easing: 'ease-in-out',
						fill: 'forwards',
					});
					try {
						await current.finished;
					} catch {
						return;
					}
					flash(hop[1]);
				}
				onlanded(flight.id);
			};
			untrack(() => {
				void travel();
			});
			return () => {
				stopped = true;
				current?.cancel();
			};
		};
	}

	function wireTone(amount: number): ClassValue {
		return [
			'fill-none transition-[opacity] duration-200 motion-reduce:transition-none',
			amount > 0 ? 'stroke-surface-elevated-border' : 'stroke-surface-50-border',
			lit !== null && 'opacity-30',
		];
	}

	function ruleCount(node: MapNode): string {
		const value = explorer.counts.get(node) ?? 0;
		return node === 'listener:model' ? count(value, 'decision') : `${value} started`;
	}
</script>

{#snippet workingList(names: readonly string[])}
	<span class="mt-2 flex min-w-0 flex-col gap-0.5">
		{#if names.length === 0}
			<span class="text-fg-tertiary text-2xs">Nothing working at {explorerClock(at)}</span>
		{:else}
			{#each names.slice(0, WORKING_ROWS) as name, index (index)}
				<span class="text-fg-secondary text-2xs flex min-w-0 items-center gap-1.5">
					<span class="bg-brand-icon size-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
					<span class="min-w-0 truncate"><SensitiveText text={name} /></span>
				</span>
			{/each}
			{#if names.length > WORKING_ROWS}
				<span class="text-fg-tertiary text-2xs">and {names.length - WORKING_ROWS} more</span>
			{/if}
		{/if}
	</span>
{/snippet}

<section aria-label="System map" class="overflow-x-auto" bind:clientWidth={width}>
	<div class="relative" style:width="{layout.width}px" style:height="{layout.height}px">
		{#each domains as domain (domain.key)}
			<div
				class="border-border-default pointer-events-none absolute rounded-2xl border border-dashed"
				style:left="{domain.box.x}px"
				style:top="{domain.box.y}px"
				style:width="{domain.box.w}px"
				style:height="{domain.box.h}px"
				aria-hidden="true"
			>
				<span
					class="bg-surface-50 text-fg-tertiary text-3xs absolute -top-2 left-3 px-1.5 font-mono whitespace-nowrap"
				>
					{domain.label}
				</span>
			</div>
		{/each}

		<svg
			class="pointer-events-none absolute inset-0 overflow-visible"
			width={layout.width}
			height={layout.height}
			aria-hidden="true"
		>
			{#each layout.segments as segment (segment.id)}
				{@const amount = traffic[segment.id] ?? 0}
				<path
					d={segment.d}
					class={wireTone(amount)}
					stroke-width={amount > BUSY_WIRE ? 1.75 : 1.25}
					stroke-dasharray={amount > 0 ? '3 4' : '2 5'}
					stroke-linecap="round"
				/>
				{#if segment.tip !== null}
					<path
						d={segment.tip}
						class={wireTone(amount)}
						stroke-width={1.25}
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				{/if}
			{/each}
			{#each litRoutes as route (route.key)}
				<path d={route.d} class="stroke-brand-icon fill-none" stroke-width={1.5} />
				<path
					d={route.tip}
					class="stroke-brand-icon fill-none"
					stroke-width={1.25}
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/each}
		</svg>

		<span
			class="bg-surface-50 text-fg-tertiary text-3xs pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 px-1.5 font-mono whitespace-nowrap"
			style:left="{layout.loopLabel.x}px"
			style:top="{layout.loopLabel.y}px"
			aria-hidden="true"
		>
			chats and jobs emit most of these events
		</span>

		<div
			class="absolute"
			style:left="{you.x}px"
			style:top="{you.y}px"
			style:width="{you.w}px"
			style:height="{you.h}px"
		>
			<Button
				bare
				pressable={false}
				ariaLabel={`You: ${count(explorer.counts.get('you') ?? 0, 'start')}`}
				ariaPressed={selectedNode === 'you'}
				class={[tone('you'), 'flex-col justify-center px-3']}
				onclick={() => onselectnode('you')}
				data-testid="explorer-node"
			>
				<span class="flex items-baseline justify-between gap-2">
					<span class="text-fg-default text-xs font-medium">You</span>
					<span class="text-fg-tertiary text-3xs font-mono tabular-nums">
						{count(explorer.counts.get('you') ?? 0, 'start')}
					</span>
				</span>
				<span class="text-fg-tertiary text-2xs truncate leading-4">
					prompts and clicks go straight to work
				</span>
			</Button>
		</div>

		{#each EVENT_ROWS as row (row)}
			{@const node = `event:${row}` as const}
			{@const box = place(node)}
			{@const source = ROW_SOURCES[row]}
			<div
				class="absolute"
				style:left="{box.x}px"
				style:top="{box.y}px"
				style:width="{box.w}px"
				style:height="{box.h}px"
			>
				<Button
					bare
					pressable={false}
					ariaLabel={`${ROW_LOOKS[row].label}: ${count(explorer.counts.get(node) ?? 0, 'event')}`}
					ariaPressed={selectedNode === node}
					class={[tone(node), 'items-center justify-between gap-2 px-2.5']}
					onclick={() => onselectnode(node)}
					data-testid="explorer-node"
				>
					<span class="flex min-w-0 items-center gap-1.5">
						<Icon name={ROW_LOOKS[row].icon} size={13} class="text-fg-tertiary shrink-0" />
						<span class="text-fg-default text-2xs truncate">{ROW_LOOKS[row].label}</span>
					</span>
					<span class="flex shrink-0 items-center gap-2">
						{#if source !== null}
							<span
								class="bg-surface-50 text-fg-tertiary text-3xs rounded px-1 font-mono leading-4"
							>
								{SOURCE_LABELS[source]}
							</span>
						{/if}
						<span class="text-fg-tertiary text-3xs font-mono tabular-nums">
							{explorer.counts.get(node) ?? 0}
						</span>
					</span>
				</Button>
			</div>
		{/each}

		<div
			class={[
				'bg-surface-100 border-surface-100-border absolute flex flex-col rounded-xl border-[0.5px] p-2.5 transition-[box-shadow,opacity] duration-200 motion-reduce:transition-none',
				(flashes.get('reconciler') ?? 0) > 0
					? 'ring-brand ring-2'
					: (lit?.nodes.has('reconciler') || selectedNode === 'reconciler') &&
						'ring-brand-icon ring-1',
				lit !== null && !lit.nodes.has('reconciler') && 'opacity-40',
			]}
			style:left="{reconciler.x}px"
			style:top="{reconciler.y}px"
			style:width="{reconciler.w}px"
			style:height="{reconciler.h}px"
		>
			<Button
				bare
				pressable={false}
				ariaLabel={`Reconciler: ${count(totalEvents, 'event')}`}
				ariaPressed={selectedNode === 'reconciler'}
				class="hover:bg-surface-100-hover flex flex-col rounded-lg px-1 pb-1 text-left"
				onclick={() => onselectnode('reconciler')}
				data-testid="explorer-node"
			>
				<span class="flex items-baseline justify-between gap-2">
					<span class="text-fg-default text-xs font-medium">{nodeLabel('reconciler')}</span>
					<span class="text-fg-tertiary text-3xs font-mono tabular-nums">{totalEvents}</span>
				</span>
				<span class="text-fg-tertiary text-2xs truncate">
					every event: rules first, then the model
				</span>
			</Button>
		</div>

		{#each LISTENERS as listener (listener)}
			{@const node = `listener:${listener}` as const}
			{@const box = place(node)}
			{@const idle = (explorer.counts.get(node) ?? 0) === 0}
			{#if listener === 'model'}
				<span
					class="text-fg-quaternary text-3xs pointer-events-none absolute flex items-center gap-2 font-mono"
					style:left="{box.x}px"
					style:top="{box.y - 18}px"
					style:width="{box.w}px"
					aria-hidden="true"
				>
					<span class="border-surface-100-border flex-1 border-t-[0.5px]"></span>
					then
					<span class="border-surface-100-border flex-1 border-t-[0.5px]"></span>
				</span>
			{/if}
			<div
				class="absolute"
				style:left="{box.x}px"
				style:top="{box.y}px"
				style:width="{box.w}px"
				style:height="{box.h}px"
			>
				<Button
					bare
					pressable={false}
					ariaLabel={`${LISTENER_LABELS[listener]}: ${ruleCount(node)}`}
					ariaPressed={selectedNode === node}
					class={ruleTone(node)}
					onclick={() => onselectnode(node)}
					data-testid="explorer-node"
				>
					<span class="flex items-baseline justify-between gap-2">
						<span class={['text-xs font-medium', idle ? 'text-fg-tertiary' : 'text-fg-default']}>
							{LISTENER_LABELS[listener]}
						</span>
						<span class="text-fg-tertiary text-3xs font-mono tabular-nums">
							{explorer.counts.get(node) ?? 0}
						</span>
					</span>
					<span class="text-fg-tertiary text-2xs truncate">{listenerNote(listener, jobs)}</span>
				</Button>
			</div>
		{/each}

		{#each WORK as node (node)}
			{@const box = place(node)}
			<div
				class="absolute"
				style:left="{box.x}px"
				style:top="{box.y}px"
				style:width="{box.w}px"
				style:height="{box.h}px"
			>
				<Button
					bare
					pressable={false}
					ariaLabel={`${nodeLabel(node)}: ${count(explorer.counts.get(node) ?? 0, node === 'chats' ? 'turn' : 'run')}`}
					ariaPressed={selectedNode === node}
					class={[tone(node), 'flex-col justify-start overflow-hidden px-3 py-2.5']}
					onclick={() => onselectnode(node)}
					data-testid="explorer-node"
				>
					<span class="flex items-baseline justify-between gap-2">
						<span class="text-fg-default text-xs font-medium">{nodeLabel(node)}</span>
						<span class="text-fg-tertiary text-3xs font-mono tabular-nums">
							{count(explorer.counts.get(node) ?? 0, node === 'chats' ? 'turn' : 'run')}
						</span>
					</span>
					{#if node === 'chats'}
						<span class="text-fg-tertiary text-2xs leading-4 text-balance">
							a new chat, or an existing one woken or resumed
						</span>
						{@render workingList(
							working.turns.map(
								(turn) => explorer.workstreams.get(turn.workstreamId)?.name ?? turn.chatName,
							),
						)}
					{:else}
						<span class="text-fg-tertiary text-2xs leading-4 text-balance">
							a new run, in its workstream or a new one
						</span>
						<span class="text-fg-secondary text-2xs mt-1 tabular-nums">
							{working.runs.length} running · {working.waiting} waiting
						</span>
						{@render workingList(
							working.runs.map((run) =>
								run.workstreamId === null
									? run.title
									: `${run.title} · ${explorer.workstreams.get(run.workstreamId)?.name ?? 'a workstream'}`,
							),
						)}
					{/if}
				</Button>
			</div>
		{/each}

		{#each flights as flight (flight.id)}
			<span
				class="bg-brand ring-surface-50 pointer-events-none absolute top-0 left-0 size-2 rounded-full ring-2"
				style:offset-anchor="center"
				style:offset-rotate="0deg"
				aria-hidden="true"
				{@attach fly(flight)}
			></span>
		{/each}
	</div>
</section>
