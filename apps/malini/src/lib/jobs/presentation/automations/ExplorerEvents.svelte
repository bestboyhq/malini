<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import type { Explorer, ExplorerItem } from '$lib/jobs/domain/explorer';
	import { explorerClock, itemIcon, itemMark, itemNote, itemTitle, itemWhy } from './explorer-copy';

	interface Props {
		explorer: Explorer;
		items: readonly ExplorerItem[];
		title: string;
		note: string;
		selectedChain: string | null;
		onselect: (item: ExplorerItem) => void;
		onclear: (() => void) | null;
	}

	let { explorer, items, title, note, selectedChain, onselect, onclear }: Props = $props();

	const headingId = $props.id();

	function placeOf(item: ExplorerItem): string {
		if (item.workstreamId === null) return 'Malini';
		return explorer.workstreams.get(item.workstreamId)?.name ?? 'Closed workstream';
	}

	function transcriptOf(item: ExplorerItem): string | null {
		if (item.kind === 'turn') {
			return workstreamHref(item.turn.workstreamId, { agentSessionId: item.turn.sessionId });
		}
		if (item.kind === 'run' && item.run.workstreamId !== null && item.run.sessionId !== null) {
			return workstreamHref(item.run.workstreamId, { agentSessionId: item.run.sessionId });
		}
		return null;
	}
</script>

<section aria-labelledby={headingId} class="flex flex-col" data-testid="explorer-events">
	<header class="flex h-10 items-center gap-2.5 pr-2 pl-4">
		<h2 id={headingId} class="text-fg-default text-xs font-medium">{title}</h2>
		<span class="text-fg-tertiary text-2xs truncate">{note}</span>
		{#if onclear}
			<Button variant="ghost" size="sm" class="ml-auto" onclick={onclear}>Show all</Button>
		{/if}
	</header>
	{#if items.length === 0}
		<p class="text-fg-tertiary px-4 pb-4 text-xs">Nothing happened here in this window.</p>
	{:else}
		<ul aria-label={title} class="flex flex-col px-1.5 pb-1.5">
			{#each items as item (item.id)}
				{@const href = transcriptOf(item)}
				{@const mark = itemMark(item)}
				{@const aside = itemNote(item)}
				{@const place = placeOf(item)}
				{@const clock = explorerClock(item.at)}
				{@const selected = selectedChain === item.chainId}
				<li
					class={[
						'flex items-center gap-1 rounded-lg pr-1',
						selected ? 'bg-surface-50-selected' : 'hover:bg-surface-50-hover',
					]}
				>
					<Button
						bare
						pressable={false}
						ariaLabel={`${itemTitle(item)}, ${place}, ${clock}`}
						ariaPressed={selected}
						class="focus-visible:ring-border-default grid h-8 min-w-0 flex-1 grid-cols-[44px_16px_minmax(0,1fr)_minmax(0,190px)_minmax(0,160px)] items-center gap-2.5 rounded-lg px-2 text-left text-xs outline-none focus-visible:ring-2"
						onclick={() => onselect(item)}
						data-testid="explorer-event"
					>
						<span class="text-fg-tertiary text-3xs font-mono tabular-nums">{clock}</span>
						<Icon name={itemIcon(item)} size={13} class="text-fg-tertiary" />
						<span class="min-w-0 truncate">
							<span class="text-fg-default"><SensitiveText text={itemTitle(item)} /></span>
							{#if mark}
								<span class={mark.tone}>· {mark.label}</span>
							{/if}
							{#if aside}
								<span class="text-fg-tertiary">· {aside}</span>
							{/if}
						</span>
						<span class="text-fg-tertiary min-w-0 truncate"><SensitiveText text={place} /></span>
						<span class="text-fg-tertiary min-w-0 truncate">{itemWhy(item, explorer)}</span>
					</Button>
					{#if href}
						<Tooltip content="Open transcript" placement="top">
							<IconButton variant="ghost" size="sm" ariaLabel="Open transcript" {href}>
								<Icon name="external-link" size={13} />
							</IconButton>
						</Tooltip>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
