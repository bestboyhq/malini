<script lang="ts">
	import { untrack } from 'svelte';
	import type { JobOutput, JobRunsIn, SaveJobDefinitionArgs } from '$contract/jobs';
	import type { JobTrigger, RoutineStatus } from '$contract/routines';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_RUN_PROFILE } from '$shared/providers/providers.api';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import ChoiceMenu from './ChoiceMenu.svelte';
	import { draftFromWords, guessTriggerId } from './recipes';
	import RunModePicker from './RunModePicker.svelte';
	import SettingRow from './SettingRow.svelte';
	import TriggerButton from './TriggerButton.svelte';
	import { EVENT_RUNS_IN_OPTIONS, runModeHint, triggerById } from './triggers';

	interface Props {
		text: string;
		title?: string | undefined;
		saving: boolean;
		error: string | null;
		onsave: (job: Omit<SaveJobDefinitionArgs, 'id'>, trigger: JobTrigger | null) => void;
		ondiscard: () => void;
	}

	let { text, title, saving, error, onsave, ondiscard }: Props = $props();

	const parsed = untrack(() => draftFromWords(text));
	const quote = untrack(() => [
		{ text: '“', strong: false },
		{ text: parsed.lead, strong: true },
		{ text: `${text.trim().slice(parsed.lead.length)}”`, strong: false },
	]);
	let name = $state(untrack(() => title) ?? parsed.name);
	let steps = $state<string[]>([...parsed.steps]);
	let when = $state<string | null>(untrack(() => triggerById(guessTriggerId(text)).when));
	let status = $state<RoutineStatus>('candidate');
	let runsIn = $state<JobRunsIn>('workstream');
	let output = $state<JobOutput>(parsed.output ?? 'none');

	const filled = $derived(steps.map((step) => step.trim()).filter(Boolean));
	const modeHint = $derived(
		status === 'candidate'
			? 'New jobs ask first. Let it run on its own once you trust it.'
			: runModeHint(status),
	);

	function onStep(index: number, value: string): void {
		steps[index] = value;
	}

	function onRemoveStep(index: number): void {
		steps.splice(index, 1);
	}

	function onSave(): void {
		onsave(
			{
				name: name.trim() || 'New job',
				instructions:
					filled.length === 1
						? (filled[0] ?? '')
						: filled.map((step, index) => `${index + 1}. ${step}`).join('\n'),
				model: DEFAULT_AGENT_MODEL,
				effort: DEFAULT_AGENT_RUN_PROFILE.effort,
				runsIn,
				output,
				skills: [],
			},
			when === null ? null : { when, status },
		);
	}
</script>

<article
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-xl border-[0.5px]"
	aria-label="New job draft"
	aria-busy={saving}
	data-testid="job-draft"
>
	<header class="flex items-start gap-3 px-4 py-3">
		<div class="min-w-0 flex-1">
			<p class="text-fg-tertiary flex items-center gap-1.5 text-xs">
				<Icon name="sparkles" size={12} />
				Drafted from your words
			</p>
			<TextInput
				bind:value={name}
				bare
				ariaLabel="Job name"
				class="mt-1 -ml-0.5 h-8 w-full"
				inputClass="text-fg-default text-lg font-semibold tracking-tight"
			/>
			<p class="text-fg-tertiary mt-1 text-xs leading-5">
				{#each quote as segment, index (index)}
					<span class={[segment.strong && 'text-fg-secondary font-medium']}>{segment.text}</span>
				{/each}
			</p>
		</div>
		<Tooltip content="Discard draft" placement="bottom">
			<IconButton variant="ghost" size="sm" ariaLabel="Discard draft" onclick={ondiscard}>
				<Icon name="close" size={14} />
			</IconButton>
		</Tooltip>
	</header>

	<SettingRow title="When" description="What starts it. Malini read it from your words.">
		<TriggerButton {when} jobName={name} onpick={(next) => (when = next)} />
	</SettingRow>

	<SettingRow title="Steps" description="Malini writes these into the job's instructions." stacked>
		<ol class="flex w-full flex-col gap-1">
			{#each steps as step, index (index)}
				<li
					class="group/step bg-surface-elevated border-surface-elevated-border flex h-9 items-center gap-2 rounded-lg border-[0.5px] pr-1 pl-2.5"
				>
					<span
						class="bg-chip text-fg-tertiary text-2xs grid size-5 shrink-0 place-items-center rounded-full tabular-nums"
					>
						{index + 1}
					</span>
					<TextInput
						value={step}
						bare
						ariaLabel={`Step ${index + 1}`}
						class="h-8 min-w-0 flex-1"
						inputClass="text-sm"
						oninput={(event) =>
							onStep(
								index,
								event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : step,
							)}
					/>
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel={`Remove step ${index + 1}`}
						class="opacity-0 group-focus-within/step:opacity-100 group-hover/step:opacity-100"
						onclick={() => onRemoveStep(index)}
					>
						<Icon name="close" size={12} />
					</IconButton>
				</li>
			{/each}
		</ol>
		<Button variant="ghost" size="sm" onclick={() => steps.push('')}>
			{#snippet leading()}
				<Icon name="plus" size={13} />
			{/snippet}
			Add a step
		</Button>
	</SettingRow>

	<SettingRow title="Runs in" description="Where the agent works on it.">
		<ChoiceMenu
			value={runsIn}
			options={when === null ? JOB_RUNS_IN_OPTIONS : EVENT_RUNS_IN_OPTIONS}
			ariaLabel="Runs in"
			icon="branch"
			onchange={(next) => (runsIn = next)}
		/>
	</SettingRow>

	<SettingRow title="When it finishes" description="What Malini does with the changes.">
		<ChoiceMenu
			value={output}
			options={JOB_OUTPUT_OPTIONS}
			ariaLabel="When it finishes"
			icon="pr-draft"
			onchange={(next) => (output = next)}
		/>
	</SettingRow>

	{#if when !== null}
		<SettingRow title="Runs" description={modeHint}>
			<RunModePicker
				value={status}
				label="How the new job runs"
				onchange={(next) => (status = next)}
			/>
		</SettingRow>
	{/if}

	<footer class="flex items-center justify-end gap-2 px-4 py-3">
		{#if error}
			<p class="text-error-content min-w-0 flex-1 text-xs" role="alert">{error}</p>
		{/if}
		<Button variant="ghost" size="sm" disabled={saving} onclick={ondiscard}>Discard</Button>
		<Button
			variant="primary"
			size="sm"
			loading={saving}
			disabled={filled.length === 0}
			onclick={onSave}
		>
			Save job
		</Button>
	</footer>
</article>
