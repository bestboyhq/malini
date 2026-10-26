<script lang="ts">
	import type { AutomaticJobBuiltin } from '$contract/jobs';
	import { Well } from '$hyper-ui/components/well';
	import { catalogModelLabel, modelCatalogQuery } from '$shared/providers/providers.api';
	import type { JobScorecard, ScorecardBand } from '$lib/jobs/domain/job-scorecard';
	import { JOB_OUTPUT_NOUN, instructionsLabel, percent, weekdayTime } from './job-insights-copy';
	import ScorecardChart from './ScorecardChart.svelte';

	interface Props {
		jobName: string;
		builtin: AutomaticJobBuiltin;
		card: JobScorecard;
	}

	let { jobName, builtin, card }: Props = $props();

	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';
	const FLAGGED_SHOWN = 8;

	const catalog = $derived(modelCatalogQuery.data);
	const noun = $derived(JOB_OUTPUT_NOUN[builtin]);
	const delta = $derived(
		card.weekRate === null || card.previousWeekRate === null
			? null
			: Math.round((card.weekRate - card.previousWeekRate) * 100),
	);

	function bandLabel(band: ScorecardBand): string {
		const setup = `${catalogModelLabel(catalog, band.setup.model)} · ${instructionsLabel(builtin, band.setup.instructions)}`;
		return band.rate === null ? setup : `${setup} · ${percent(band.rate)} followed`;
	}
</script>

<Well title="Last 2 weeks">
	{#snippet trailing()}
		<span class="text-fg-tertiary text-2xs flex items-center gap-1.5 pr-1.5" aria-hidden="true">
			<span class="bg-warning-content/75 size-2 rounded-sm"></span>
			Broke a rule
			<span class="bg-chip ml-2 size-2 rounded-sm"></span>
			Followed every rule
		</span>
	{/snippet}
	<div class={ROWS}>
		{#if card.bands.length === 0}
			<p class="text-fg-tertiary px-4 py-3 text-xs">
				No {noun.many} yet. {jobName} records {noun.gives} from now on, and they show up here.
			</p>
		{:else}
			<div class="divide-surface-50-border grid grid-cols-3 divide-x-[0.5px]">
				<div class="flex flex-col gap-0.5 px-4 py-3">
					<span class="text-fg-default text-xl font-semibold tracking-tight tabular-nums">
						{card.total}
					</span>
					<span class="text-fg-tertiary text-xs">
						{card.total === 1 ? noun.one : noun.many} in 2 weeks
					</span>
				</div>
				<div class="flex flex-col gap-0.5 px-4 py-3">
					<span class="flex items-baseline gap-2">
						<span class="text-fg-default text-xl font-semibold tracking-tight tabular-nums">
							{card.weekRate === null ? '–' : percent(card.weekRate)}
						</span>
						{#if delta !== null}
							<span
								class={['text-xs', delta >= 0 ? 'text-success-content' : 'text-warning-content']}
							>
								{delta >= 0 ? '+' : '−'}{Math.abs(delta)} pts vs the week before
							</span>
						{/if}
					</span>
					<span class="text-fg-tertiary text-xs">followed every rule this week</span>
				</div>
				<div class="flex flex-col gap-0.5 px-4 py-3">
					<span
						class={[
							'text-xl font-semibold tracking-tight tabular-nums',
							card.broke > 0 ? 'text-warning-content' : 'text-fg-default',
						]}
					>
						{card.broke}
					</span>
					<span class="text-fg-tertiary text-xs">broke a rule</span>
				</div>
			</div>
			<ScorecardChart {card} label={bandLabel} />
		{/if}
	</div>
</Well>

{#if card.flagged.length > 0}
	<Well
		title={`${noun.many.charAt(0).toUpperCase()}${noun.many.slice(1)} that broke a rule this week`}
		note={`${card.flagged.length}`}
	>
		<ul class={[ROWS, 'flex flex-col']}>
			{#each card.flagged.slice(0, FLAGGED_SHOWN) as { output, issues } (output.id)}
				<li class="flex h-10 min-w-0 items-center gap-2.5 px-4 text-xs">
					<span class="text-fg-default shrink-0 font-medium">
						{output.output ?? `No ${noun.one}`}
					</span>
					{#each issues as issue (issue)}
						<span class="bg-warning text-warning-content text-2xs shrink-0 rounded-md px-1.5 py-px">
							{issue}
						</span>
					{/each}
					<span class="text-fg-tertiary min-w-0 flex-1 truncate">{output.excerpt}</span>
					<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums">
						{weekdayTime(output.createdAt)}
					</span>
				</li>
			{/each}
		</ul>
	</Well>
{/if}
