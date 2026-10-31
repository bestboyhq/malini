<script lang="ts">
	import { onMount } from 'svelte';
	import {
		isAgentlessJobBuiltin,
		isAutomaticJobBuiltin,
		type JobDefinitionRecord,
	} from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { jobImproveHref } from '$shared/router/routes-hrefs';
	import { deleteJobDefinitionCommand } from '$lib/jobs/application/commands/delete-job-definition.command';
	import { loadJobScorecardCommand } from '$lib/jobs/application/commands/load-job-scorecard.command';
	import { resetJobDefinitionCommand } from '$lib/jobs/application/commands/reset-job-definition.command';
	import { updateJobSettingsCommand } from '$lib/jobs/application/commands/update-job-settings.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { jobScorecardErrorQuery } from '$lib/jobs/application/queries/job-scorecard-error.query.svelte';
	import { jobScorecardQuery } from '$lib/jobs/application/queries/job-scorecard.query.svelte';
	import { jobSettingsStateQuery } from '$lib/jobs/application/queries/job-settings-state.query.svelte';
	import { isRunnableJob, takesThen } from '$lib/jobs/domain/builtin-jobs';
	import { scheduleOf } from '$lib/jobs/domain/schedule';
	import { JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRunRow from '../JobRunRow.svelte';
	import JobRunTarget from '../JobRunTarget.svelte';
	import AutomationsSection from './AutomationsSection.svelte';
	import ChoiceMenu from './ChoiceMenu.svelte';
	import JobScorecard from './JobScorecard.svelte';
	import RunModePicker from './RunModePicker.svelte';
	import SchedulePlaceMenu from './SchedulePlaceMenu.svelte';
	import SettingRow from './SettingRow.svelte';
	import TriggerButton from './TriggerButton.svelte';
	import {
		builtinTrigger,
		EVENT_RUNS_IN_OPTIONS,
		jobSentence,
		runModeHint,
		SCHEDULE_RUNS_IN_HINT,
		thenChoices,
		UPDATE_FROM_MAIN_THEN,
	} from './triggers';

	interface Props {
		job: JobDefinitionRecord;
		jobs: readonly JobDefinitionRecord[];
	}

	let { job, jobs }: Props = $props();

	const RECENT_RUNS = 10;
	const NOTHING = '';
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';

	let nowMs = $state(Date.now());
	let confirming = $state<'delete' | 'reset' | null>(null);
	let choosingTarget = $state(false);

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const actionState = $derived(jobActionStateQuery.data(job.id));
	const settingsState = $derived(jobSettingsStateQuery.data(job.id));
	const runs = $derived(runsFor(job.id).slice(0, RECENT_RUNS));
	const fixed = $derived(builtinTrigger(job));
	const runnable = $derived(isRunnableJob(job));
	const thenable = $derived(takesThen(job));
	const agentless = $derived(isAgentlessJobBuiltin(job.builtin));
	const schedule = $derived(scheduleOf(job.trigger?.when));
	const scorecardFor = $derived(jobScorecardQuery.data);
	const scorecard = $derived(scorecardFor(job, nowMs));
	const scorecardError = $derived(jobScorecardErrorQuery.data(job.id));
	const thenName = $derived(jobs.find((other) => other.id === job.thenJobId)?.name ?? null);
	const thenOptions = $derived([
		{ value: NOTHING, label: 'Nothing' },
		...thenChoices(jobs, job.id),
	]);
	const editorKey = $derived(
		JSON.stringify([job.id, job.name, job.instructions, job.model, job.effort, job.skills]),
	);

	onMount(() => {
		if (isAutomaticJobBuiltin(job.builtin)) loadJobScorecardCommand(job.id);
	});

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onWhen(when: string | null): void {
		updateJobSettingsCommand(job, {
			trigger: when === null ? null : { when, mode: job.trigger?.mode ?? 'ask' },
		});
	}

	function onConfirm(): void {
		if (confirming === 'delete') deleteJobDefinitionCommand(job.id);
		if (confirming === 'reset') resetJobDefinitionCommand(job.id);
		confirming = null;
	}
</script>

<AutomationsSection title={job.name} description={jobSentence(job, thenName)}>
	{#snippet actions()}
		<div class="flex shrink-0 items-center gap-1.5">
			{#if confirming}
				<span class="text-fg-secondary text-xs">
					{confirming === 'delete' ? 'Delete this job?' : 'Undo your edits?'}
				</span>
				<Button
					variant={confirming === 'delete' ? 'danger' : 'secondary'}
					size="sm"
					ariaLabel={confirming === 'delete'
						? `Confirm deleting ${job.name}`
						: `Confirm resetting ${job.name}`}
					onclick={onConfirm}
				>
					{confirming === 'delete' ? 'Delete' : 'Reset'}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => (confirming = null)}>Keep</Button>
			{:else}
				{#if job.builtin !== null}
					<Button
						variant="ghost"
						size="sm"
						ariaLabel={`Reset ${job.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'reset')}
					>
						Reset
					</Button>
				{:else}
					<Button
						variant="danger-ghost"
						size="sm"
						ariaLabel={`Delete ${job.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'delete')}
					>
						Delete
					</Button>
				{/if}
				{#if isAutomaticJobBuiltin(job.builtin)}
					<Button variant="primary" size="sm" href={jobImproveHref(job.id)}>
						{#snippet leading()}
							<Icon name="sparkles" size={12} />
						{/snippet}
						Improve
					</Button>
				{/if}
				{#if runnable}
					<Button
						variant="primary"
						size="sm"
						ariaLabel={`Run ${job.name}`}
						ariaExpanded={choosingTarget}
						loading={actionState.busy}
						onclick={() => (choosingTarget = !choosingTarget)}
					>
						{#snippet leading()}
							<Icon name="play" size={12} />
						{/snippet}
						Run
					</Button>
				{/if}
			{/if}
		</div>
	{/snippet}

	{#if actionState.error}
		<p
			class="border-error-content/20 bg-error text-error-content rounded-xl border-[0.5px] px-4 py-3 text-xs"
			role="alert"
		>
			{actionState.error}
		</p>
	{/if}

	{#if scorecardError}
		<p
			class="border-error-content/20 bg-error text-error-content rounded-xl border-[0.5px] px-4 py-3 text-xs"
			role="alert"
		>
			{scorecardError}
		</p>
	{/if}

	{#if scorecard && isAutomaticJobBuiltin(job.builtin)}
		<JobScorecard jobName={job.name} builtin={job.builtin} card={scorecard} />
	{/if}

	{#if choosingTarget && runnable}
		<Well title="Run it now">
			<div class={ROWS}>
				<JobRunTarget definition={job} onclose={() => (choosingTarget = false)} />
			</div>
		</Well>
	{/if}

	<Well title="How it runs">
		<div class={ROWS}>
			<SettingRow title="When" description={fixed ? 'Built into Malini.' : 'What starts it.'}>
				{#if fixed}
					<span class="text-fg-secondary flex items-center gap-1.5 text-xs">
						<Icon name={fixed.icon} size={14} />
						{fixed.label}
					</span>
				{:else}
					<TriggerButton
						when={job.trigger?.when ?? null}
						jobName={job.name}
						disabled={settingsState.busy}
						schedulable={!agentless}
						onpick={onWhen}
					/>
				{/if}
			</SettingRow>
			<SettingRow
				title="Runs"
				description={fixed
					? 'On its own, whenever it fires.'
					: job.trigger === null
						? 'Only when you start it: type / in any chat.'
						: runModeHint(job.trigger.mode)}
			>
				{#if !fixed && job.trigger !== null}
					{@const trigger = job.trigger}
					<RunModePicker
						value={trigger.mode}
						label={`How ${job.name} runs`}
						disabled={settingsState.busy}
						onchange={(mode) => updateJobSettingsCommand(job, { trigger: { ...trigger, mode } })}
					/>
				{/if}
			</SettingRow>
			{#if schedule && job.trigger}
				{@const trigger = job.trigger}
				<SettingRow title="Runs in" description={SCHEDULE_RUNS_IN_HINT}>
					<SchedulePlaceMenu
						{schedule}
						onchange={(when) => updateJobSettingsCommand(job, { trigger: { ...trigger, when } })}
					/>
				</SettingRow>
			{:else if job.builtin === null}
				<SettingRow title="Runs in" description="Where the agent works on it.">
					<ChoiceMenu
						value={job.runsIn}
						options={job.trigger === null ? JOB_RUNS_IN_OPTIONS : EVENT_RUNS_IN_OPTIONS}
						ariaLabel="Runs in"
						icon="branch"
						onchange={(runsIn) => updateJobSettingsCommand(job, { runsIn })}
					/>
				</SettingRow>
			{/if}
			{#if thenable}
				<SettingRow title="Then" description="The job that runs next, once this one succeeds.">
					<ChoiceMenu
						value={job.thenJobId ?? NOTHING}
						options={thenOptions}
						ariaLabel="Then"
						icon="arrow-right"
						onchange={(thenJobId) =>
							updateJobSettingsCommand(job, {
								thenJobId: thenJobId === NOTHING ? null : thenJobId,
							})}
					/>
				</SettingRow>
			{:else if job.builtin === 'update-from-main'}
				<SettingRow title="Then" description="What runs next.">
					<span class="text-fg-secondary text-xs">{UPDATE_FROM_MAIN_THEN}</span>
				</SettingRow>
			{/if}
			{#if settingsState.error}
				<p class="text-error-content px-4 py-3 text-xs" role="alert">
					{settingsState.error}
				</p>
			{/if}
		</div>
	</Well>

	{#if runnable}
		<Well title="Recent runs" note={runs.length > 0 ? `${runs.length}` : undefined}>
			<div class={ROWS}>
				{#if runs.length > 0}
					<ul class="flex flex-col p-1" aria-label="Recent runs">
						{#each runs as run (run.id)}
							<li><JobRunRow {run} {nowMs} placeFirst /></li>
						{/each}
					</ul>
				{:else}
					<p class="text-fg-tertiary px-4 py-3 text-xs">
						No runs yet. Run it from here, or type / in any chat.
					</p>
				{/if}
			</div>
		</Well>
	{/if}

	{#if agentless}
		<Well title="What it does">
			<p class={[ROWS, 'text-fg-secondary px-4 py-3 text-xs leading-5']}>
				{job.instructions}
			</p>
		</Well>
	{:else}
		<Well title="Instructions">
			<div class={[ROWS, 'p-4']}>
				{#key editorKey}
					<JobEditor definition={job} />
				{/key}
			</div>
		</Well>
	{/if}
</AutomationsSection>
