<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import JobRunRow from '../JobRunRow.svelte';
	import { labIsManual, labTrigger, type LabJobSetup } from './lab-triggers';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
		setupOf: (definition: JobDefinitionRecord) => LabJobSetup;
	}

	let { jobs, setupOf }: Props = $props();

	const RECENT_LIMIT = 20;

	let nowMs = $state(Date.now());
	let dismissed = $state<readonly string[]>([]);

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const runs = $derived(
		jobs
			.flatMap((job) => runsFor(job.id))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
	);
	const needsYou = $derived(runs.filter((run) => run.status === 'needs-you'));
	const running = $derived(
		runs.filter((run) => run.status === 'running' || run.status === 'queued'),
	);
	const recent = $derived(
		runs
			.filter((run) => !['needs-you', 'running', 'queued'].includes(run.status))
			.slice(0, RECENT_LIMIT),
	);
	const asking = $derived(
		jobs.filter((job) => {
			const setup = setupOf(job);
			return setup.mode === 'ask' && !labIsManual(setup) && !dismissed.includes(job.id);
		}),
	);
	const waiting = $derived(needsYou.length + asking.length);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), running.length > 0 ? 1_000 : 30_000);
		return () => clearInterval(clock);
	});

	function onDismiss(job: JobDefinitionRecord): void {
		dismissed = [...dismissed, job.id];
	}
</script>

{#snippet heading(label: string, count: number)}
	<h3 class="text-fg-tertiary flex items-center gap-1.5 px-1 text-xs font-medium">
		{label}
		{#if count > 0}
			<span class="tabular-nums">{count}</span>
		{/if}
	</h3>
{/snippet}

<aside
	class="border-surface-50-border flex w-[340px] shrink-0 flex-col border-l-[0.5px]"
	aria-label="Activity"
	data-testid="lab-activity-rail"
>
	<h2 class="text-fg-default px-5 pt-1 pb-3 text-sm font-semibold">Activity</h2>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Job activity">
		<div class="flex flex-col gap-6 px-3 pb-8">
			<section class="flex flex-col gap-2" aria-label="Waiting for you">
				{@render heading('Waiting for you', waiting)}
				{#if waiting === 0}
					<p class="text-fg-tertiary px-1 text-xs">Nothing waits for you.</p>
				{/if}
				{#each asking as job (job.id)}
					<article
						class="border-warning-content/20 bg-warning flex flex-col gap-2.5 rounded-xl border-[0.5px] p-3"
						aria-label={`${job.name} wants to run`}
					>
						<div class="flex items-start gap-2">
							<span class="text-warning-content mt-0.5 shrink-0">
								<Icon name={labTrigger(setupOf(job)).icon} size={13} />
							</span>
							<p class="min-w-0 flex-1 text-xs leading-5">
								<span class="text-fg-default font-medium">{job.name}</span>
								<span class="text-fg-secondary">wants to run.</span>
								<span class="text-fg-tertiary">{labTrigger(setupOf(job)).label}.</span>
								<span class="text-warning-content text-2xs font-medium">Preview</span>
							</p>
						</div>
						<div class="flex justify-end gap-1.5">
							<Button variant="ghost" size="xs" onclick={() => onDismiss(job)}>Skip</Button>
							<Button variant="primary" size="xs" onclick={() => onDismiss(job)}>Run it</Button>
						</div>
					</article>
				{/each}
				{#if needsYou.length > 0}
					<ul class="flex flex-col">
						{#each needsYou as run (run.id)}
							<li><JobRunRow {run} {nowMs} /></li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if running.length > 0}
				<section class="flex flex-col gap-2" aria-label="Running now">
					{@render heading('Running now', running.length)}
					<ul class="flex flex-col">
						{#each running as run (run.id)}
							<li><JobRunRow {run} {nowMs} /></li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="flex flex-col gap-2" aria-label="Recent runs">
				{@render heading('Recent', 0)}
				{#if recent.length === 0}
					<p class="text-fg-tertiary px-1 text-xs">Runs show up here as they happen.</p>
				{:else}
					<ul class="flex flex-col">
						{#each recent as run (run.id)}
							<li><JobRunRow {run} {nowMs} /></li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	</ScrollableDiv>
</aside>
