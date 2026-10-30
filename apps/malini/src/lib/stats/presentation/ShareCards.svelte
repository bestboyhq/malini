<script lang="ts">
	import { onMount } from 'svelte';
	import type { PublishedStats, ShareCard } from '$contract/stats';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Icon } from '$hyper-ui/icons';
	import { copyShareCardCommand } from '$lib/stats/application/commands/copy-share-card.command';
	import { loadShareCardCommand } from '$lib/stats/application/commands/load-share-card.command';
	import { shareCardQuery } from '$lib/stats/application/queries/share-card.query.svelte';
	import { shareCardPng, type ShareCardKind } from './share-cards';

	type Previews = Partial<Record<ShareCardKind, string>>;

	const KINDS: readonly Readonly<{ kind: ShareCardKind; label: string }>[] = [
		{ kind: 'heatmap', label: 'Heatmap' },
		{ kind: 'readout', label: 'Readout' },
	];
	const throughFormat = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});

	const card = $derived(shareCardQuery.data);
	const previews = $derived(card?.stats ? drawPreviews(card, card.stats) : null);

	onMount(loadShareCardCommand);

	async function drawPreviews(shown: ShareCard, stats: PublishedStats): Promise<Previews> {
		const drawn: Previews = {};
		for (const { kind } of KINDS) {
			try {
				drawn[kind] = await shareCardPng(kind, shown, stats);
			} catch (error) {
				console.error(`[malini stats] could not draw the ${kind} card`, error);
			}
		}
		return drawn;
	}

	function onCopy(kind: ShareCardKind): void {
		const shown = card;
		const drawing = previews;
		if (!shown?.stats || !drawing) return;
		copyShareCardCommand(cardPng(kind, drawing, shown, shown.stats));
	}

	async function cardPng(
		kind: ShareCardKind,
		drawing: Promise<Previews>,
		shown: ShareCard,
		stats: PublishedStats,
	): Promise<string> {
		return (await drawing)[kind] ?? shareCardPng(kind, shown, stats);
	}
</script>

<section
	class="border-surface-elevated-border rounded-xl border-[0.5px] p-3"
	aria-label="Share card"
	data-testid="share-cards"
>
	<div class="flex items-baseline justify-between gap-3">
		<h3 class="text-fg-secondary text-xs font-medium">Share card</h3>
		{#if card?.stats}
			<span class="text-fg-tertiary text-xs tabular-nums">
				Through {throughFormat.format(new Date(`${card.stats.through}T00:00:00Z`))}
			</span>
		{/if}
	</div>
	{#if card && !card.stats}
		<p class="text-fg-tertiary mt-2 text-xs">
			Your first card is ready after your first full day with Malini.
		</p>
	{:else}
		<ul class="mt-2.5 grid grid-cols-2 gap-2" aria-label="Share cards">
			{#each KINDS as { kind, label } (kind)}
				<li>
					<Button
						bare
						class="group flex w-full cursor-pointer flex-col gap-1.5 text-left"
						ariaLabel={`Copy the ${label.toLowerCase()} card`}
						disabled={!card?.stats}
						onclick={() => onCopy(kind)}
					>
						{#await previews}
							<Skeleton class="aspect-[40/21] w-full" ariaLabel={`Drawing the ${label} card`} />
						{:then drawn}
							{#if drawn?.[kind]}
								<img
									src={drawn[kind]}
									alt=""
									draggable="false"
									class="block aspect-[40/21] w-full rounded-md"
								/>
							{:else}
								<Skeleton class="aspect-[40/21] w-full" ariaLabel={`Drawing the ${label} card`} />
							{/if}
						{/await}
						<span
							class="text-fg-tertiary group-hover:text-fg-secondary flex items-center gap-1 text-xs"
						>
							<Icon name="copy" size={12} />
							{label}
						</span>
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
