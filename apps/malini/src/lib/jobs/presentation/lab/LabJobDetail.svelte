<script lang="ts">
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Modal } from '$hyper-ui/components/modal';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRunRow from '../JobRunRow.svelte';
	import { LAB_RUN_MODES, labIsManual, labSentence, type LabJobSetup } from './lab-triggers';
	import LabChoiceMenu from './LabChoiceMenu.svelte';
	import LabRow from './LabRow.svelte';
	import LabRunsMode from './LabRunsMode.svelte';
	import LabSection from './LabSection.svelte';
	import LabTriggerButton from './LabTriggerButton.svelte';

	interface Props {
		job: JobDefinitionRecord;
		setup: LabJobSetup;
		editable?: boolean;
		onsetup: (setup: LabJobSetup) => void;
		onclose: () => void;
	}

	let { job, setup, editable = true, onsetup, onclose }: Props = $props();

	const RECENT_RUNS = 10;
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';

	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const runs = $derived(runsFor(job.id).slice(0, RECENT_RUNS));
	const manual = $derived(labIsManual(setup));
	const automatic = $derived(isAutomaticJobBuiltin(job.builtin));
	const modeHint = $derived(
		LAB_RUN_MODES.find((option) => option.value === setup.mode)?.hint ?? '',
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});
</script>

<Modal
	open
	ariaLabel={job.name}
	{onclose}
	class="h-[min(720px,calc(100vh_-_4rem))] w-[min(800px,calc(100vw_-_4rem))] overflow-hidden rounded-[32px]"
	contentClass="bg-surface-root flex size-full min-h-0 p-2"
>
	{#snippet children(dismiss)}
		<div
			class="bg-surface-50 border-surface-50-border relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
			data-testid="lab-job-detail"
		>
			<div class="absolute top-5 right-4.5 z-10">
				<Tooltip content="Close" placement="bottom">
					<IconButton variant="ghost" size="sm" ariaLabel={`Close ${job.name}`} onclick={dismiss}>
						<Icon name="close" size={16} />
					</IconButton>
				</Tooltip>
			</div>
			<LabSection title={job.name} description={labSentence(job, setup)}>
				<Well title="How it runs">
					<div class={ROWS}>
						<LabRow title="When" description="What starts it.">
							<LabTriggerButton {setup} jobName={job.name} onchange={onsetup} />
						</LabRow>
						<LabRow
							title="Runs"
							description={manual ? 'Only when you start it: type / in any chat.' : modeHint}
						>
							{#if !manual}
								<LabRunsMode
									value={setup.mode}
									label={`How ${job.name} runs`}
									onchange={(mode) => onsetup({ ...setup, mode })}
								/>
							{/if}
						</LabRow>
						{#if !automatic}
							<LabRow title="Runs in" description="Where the agent works on it.">
								<LabChoiceMenu
									value={setup.runsIn ?? job.runsIn}
									options={JOB_RUNS_IN_OPTIONS}
									ariaLabel="Runs in"
									icon="branch"
									onchange={(runsIn) => onsetup({ ...setup, runsIn })}
								/>
							</LabRow>
							<LabRow title="When it finishes" description="What Malini does with the changes.">
								<LabChoiceMenu
									value={setup.output ?? job.output}
									options={JOB_OUTPUT_OPTIONS}
									ariaLabel="When it finishes"
									icon="pr-draft"
									onchange={(output) => onsetup({ ...setup, output })}
								/>
							</LabRow>
						{/if}
					</div>
				</Well>

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

				<Well title="Instructions">
					<div class={[ROWS, 'p-4']}>
						{#if editable}
							<JobEditor definition={job} />
						{:else}
							<p class="text-fg-secondary text-xs leading-5 whitespace-pre-line">
								{job.instructions}
							</p>
						{/if}
					</div>
				</Well>
			</LabSection>
		</div>
	{/snippet}
</Modal>
