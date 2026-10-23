<script lang="ts">
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import type { JobScorecard, ScorecardBand } from '$lib/jobs/domain/job-scorecard';
	import { percent, shortDay } from './job-insights-copy';

	interface Props {
		card: JobScorecard;
		label: (band: ScorecardBand) => string;
	}

	let { card, label }: Props = $props();

	const RIGHT_ALIGNED_FROM = 0.6;
	const LABELLED_SLOTS = 3;

	const slots = $derived(Array.from({ length: card.slots }, (_, slot) => card.days[slot] ?? null));
	const tallest = $derived(Math.max(1, ...card.days.map((day) => day.total)));
	const latest = $derived(card.bands.at(-1) ?? null);
	const changes = $derived(card.bands.filter((band) => band.changed));
	const summary = $derived(
		`${card.total} ${card.total === 1 ? 'name' : 'names'} in the last 2 weeks, ${card.broke} broke a rule`,
	);

	function share(slot: number): number {
		return slot / card.slots;
	}

	function at(slot: number): string {
		return `${share(slot) * 100}%`;
	}

	function changeLabel(band: ScorecardBand): string {
		const day = card.days[band.start];
		const when = band.start === card.days.length - 1 || !day ? 'today' : shortDay(day.date);
		if (band.setup.expectedRate === null) return `Changed ${when}`;
		return `Applied ${when} · expected ${percent(band.setup.expectedRate)} to follow every rule`;
	}
</script>

<div class="px-4 pt-3 pb-3" role="img" aria-label={summary}>
	<div class="relative pt-6">
		<div class="flex h-24 items-end">
			{#each slots as day, slot (slot)}
				<div class="flex h-full min-w-0 flex-1 flex-col justify-end px-0.5">
					{#if day && day.total > 0}
						<div
							class="flex w-full flex-col overflow-hidden rounded-md"
							style:height={`${(day.total / tallest) * 100}%`}
						>
							<div
								class="bg-warning-content/75 shrink-0"
								style:height={`${(day.broke / day.total) * 100}%`}
							></div>
							<div class="bg-chip flex-1"></div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="mt-2 flex">
			{#each slots as day, slot (slot)}
				<span class="text-fg-tertiary text-2xs min-w-0 flex-1 text-center whitespace-nowrap">
					{day && slot % 2 === 0 ? shortDay(day.date) : ''}
				</span>
			{/each}
		</div>
		<div class="relative mt-2 h-6">
			{#each card.bands as band (band.setup.id)}
				{@const wide = band.end - band.start >= LABELLED_SLOTS}
				<div
					class="absolute inset-y-0"
					style:left={at(band.start)}
					style:width={`calc(${at(band.end - band.start)} - 2px)`}
				>
					<Tooltip
						content={label(band)}
						placement="bottom"
						onlyWhenTruncated={wide}
						class="size-full"
					>
						<div
							class={[
								'flex size-full items-center overflow-hidden rounded-md px-2.5',
								band === latest && band.setup.expectedRate !== null
									? 'bg-success text-success-content'
									: 'bg-chip text-fg-secondary',
							]}
						>
							{#if wide}
								<span class="text-2xs truncate">{label(band)}</span>
							{/if}
						</div>
					</Tooltip>
				</div>
			{/each}
		</div>
		{#each changes as band (band.setup.id)}
			<div
				class="border-success-content pointer-events-none absolute top-4 bottom-0 border-l border-dashed"
				style:left={at(band.start)}
			></div>
			<span
				class="text-success-content text-2xs absolute top-0 whitespace-nowrap"
				style:left={share(band.start) < RIGHT_ALIGNED_FROM ? `calc(${at(band.start)} + 6px)` : null}
				style:right={share(band.start) < RIGHT_ALIGNED_FROM
					? null
					: `calc(${100 - share(band.start) * 100}% + 6px)`}
			>
				{changeLabel(band)}
			</span>
		{/each}
	</div>
</div>
