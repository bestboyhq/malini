<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { Sheet } from '$hyper-ui/components/sheet';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRecentRuns from '../JobRecentRuns.svelte';
	import { LAB_RUN_MODES, labIsManual, labSentence, type LabJobSetup } from './lab-triggers';
	import LabChoiceMenu from './LabChoiceMenu.svelte';
	import LabRunsMode from './LabRunsMode.svelte';
	import LabTriggerButton from './LabTriggerButton.svelte';

	interface Props {
		job: JobDefinitionRecord;
		setup: LabJobSetup;
		editable?: boolean;
		onsetup: (setup: LabJobSetup) => void;
		onclose: () => void;
	}

	let { job, setup, editable = true, onsetup, onclose }: Props = $props();

	const manual = $derived(labIsManual(setup));
	const automatic = $derived(isAutomaticJobBuiltin(job.builtin));
	const modeHint = $derived(LAB_RUN_MODES.find((option) => option.value === setup.mode)?.hint);
</script>

{#snippet setupRow(label: string, body: Snippet)}
	<div
		class="border-surface-50-border grid grid-cols-[56px_1fr] items-center gap-3 border-t-[0.5px] px-4 py-3 first:border-t-0"
	>
		<span class="text-fg-tertiary text-xs font-medium">{label}</span>
		<div class="flex min-w-0 flex-wrap items-center gap-2">{@render body()}</div>
	</div>
{/snippet}

<Sheet open title={job.name} description={labSentence(job, setup)} class="max-w-[800px]" {onclose}>
	<div class="flex flex-col gap-8 pt-1">
		<section
			class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px]"
			aria-label="How it runs"
		>
			{#snippet whenBody()}
				<LabTriggerButton {setup} jobName={job.name} onchange={onsetup} />
			{/snippet}
			{@render setupRow('When', whenBody)}

			{#snippet howBody()}
				{#if manual}
					<p class="text-fg-tertiary text-xs">Only when you start it: type / in any chat.</p>
				{:else}
					<LabRunsMode
						value={setup.mode}
						label={`How ${job.name} runs`}
						onchange={(mode) => onsetup({ ...setup, mode })}
					/>
					<p class="text-fg-tertiary min-w-0 truncate text-xs">{modeHint}</p>
				{/if}
			{/snippet}
			{@render setupRow('How', howBody)}

			{#if !automatic}
				{#snippet whereBody()}
					<LabChoiceMenu
						value={setup.runsIn ?? job.runsIn}
						options={JOB_RUNS_IN_OPTIONS}
						ariaLabel="Runs in"
						icon="branch"
						onchange={(runsIn) => onsetup({ ...setup, runsIn })}
					/>
				{/snippet}
				{@render setupRow('Where', whereBody)}

				{#snippet thenBody()}
					<LabChoiceMenu
						value={setup.output ?? job.output}
						options={JOB_OUTPUT_OPTIONS}
						ariaLabel="When it finishes"
						icon="pr-draft"
						onchange={(output) => onsetup({ ...setup, output })}
					/>
				{/snippet}
				{@render setupRow('Then', thenBody)}
			{/if}
		</section>

		<JobRecentRuns definitionId={job.id} />

		<section class="flex flex-col gap-3" aria-labelledby="lab-job-sheet-instructions">
			<h3 id="lab-job-sheet-instructions" class="text-fg-default text-sm font-medium">
				Instructions
			</h3>
			{#if editable}
				<JobEditor definition={job} />
			{:else}
				<p class="text-fg-secondary text-xs leading-5 whitespace-pre-line">{job.instructions}</p>
			{/if}
		</section>
	</div>
</Sheet>
