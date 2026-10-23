<script lang="ts">
	import type { JobDefinitionRecord, JobOutput, JobRunsIn } from '$contract/jobs';
	import type { JobTrigger } from '$contract/routines';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { deleteJobDefinitionCommand } from '$lib/jobs/application/commands/delete-job-definition.command';
	import { resetJobDefinitionCommand } from '$lib/jobs/application/commands/reset-job-definition.command';
	import { saveJobDefinitionCommand } from '$lib/jobs/application/commands/save-job-definition.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { isRunnableJob } from '$lib/jobs/domain/builtin-jobs';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRunRow from '../JobRunRow.svelte';
	import JobRunTarget from '../JobRunTarget.svelte';
	import type { ActionState } from './automations-state.svelte';
	import AutomationsSection from './AutomationsSection.svelte';
	import ChoiceMenu from './ChoiceMenu.svelte';
	import RunModePicker from './RunModePicker.svelte';
	import SettingRow from './SettingRow.svelte';
	import TriggerButton from './TriggerButton.svelte';
	import { builtinTrigger, EVENT_RUNS_IN_OPTIONS, jobSentence, runModeHint } from './triggers';

	interface Props {
		job: JobDefinitionRecord;
		trigger: JobTrigger | null;
		triggerState: ActionState;
		ontrigger: (trigger: JobTrigger | null) => void;
	}

	let { job, trigger, triggerState, ontrigger }: Props = $props();

	const RECENT_RUNS = 10;
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';

	let nowMs = $state(Date.now());
	let confirming = $state<'delete' | 'reset' | null>(null);
	let choosingTarget = $state(false);

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const actionState = $derived(jobActionStateQuery.data(job.id));
	const runs = $derived(runsFor(job.id).slice(0, RECENT_RUNS));
	const fixed = $derived(builtinTrigger(job));
	const runnable = $derived(isRunnableJob(job));
	const editorKey = $derived(
		JSON.stringify([job.id, job.name, job.instructions, job.model, job.effort, job.skills]),
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onWhen(when: string | null): void {
		ontrigger(when === null ? null : { when, status: trigger?.status ?? 'candidate' });
	}

	function onPlace(change: Readonly<{ runsIn?: JobRunsIn; output?: JobOutput }>): void {
		saveJobDefinitionCommand({
			id: job.id,
			name: job.name,
			instructions: job.instructions,
			model: job.model,
			effort: job.effort,
			runsIn: change.runsIn ?? job.runsIn,
			output: change.output ?? job.output,
			skills: job.skills,
		});
	}

	function onConfirm(): void {
		if (confirming === 'delete') deleteJobDefinitionCommand(job.id);
		if (confirming === 'reset') resetJobDefinitionCommand(job.id);
		confirming = null;
	}
</script>

<AutomationsSection title={job.name} description={jobSentence(job, trigger)}>
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
						when={trigger?.when ?? null}
						jobName={job.name}
						disabled={triggerState.busy}
						onpick={onWhen}
					/>
				{/if}
			</SettingRow>
			<SettingRow
				title="Runs"
				description={fixed
					? 'On its own, whenever it fires.'
					: trigger === null
						? 'Only when you start it: type / in any chat.'
						: runModeHint(trigger.status)}
			>
				{#if !fixed && trigger !== null}
					<RunModePicker
						value={trigger.status}
						label={`How ${job.name} runs`}
						disabled={triggerState.busy}
						onchange={(status) => ontrigger({ ...trigger, status })}
					/>
				{/if}
			</SettingRow>
			{#if job.builtin === null}
				<SettingRow title="Runs in" description="Where the agent works on it.">
					<ChoiceMenu
						value={job.runsIn}
						options={trigger === null ? JOB_RUNS_IN_OPTIONS : EVENT_RUNS_IN_OPTIONS}
						ariaLabel="Runs in"
						icon="branch"
						onchange={(runsIn) => onPlace({ runsIn })}
					/>
				</SettingRow>
				<SettingRow title="When it finishes" description="What Malini does with the changes.">
					<ChoiceMenu
						value={job.output}
						options={JOB_OUTPUT_OPTIONS}
						ariaLabel="When it finishes"
						icon="pr-draft"
						onchange={(output) => onPlace({ output })}
					/>
				</SettingRow>
			{/if}
			{#if triggerState.error}
				<p class="text-error-content px-4 py-3 text-xs" role="alert">
					{triggerState.error}
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

	<Well title="Instructions">
		<div class={[ROWS, 'p-4']}>
			{#key editorKey}
				<JobEditor definition={job} />
			{/key}
		</div>
	</Well>
</AutomationsSection>
