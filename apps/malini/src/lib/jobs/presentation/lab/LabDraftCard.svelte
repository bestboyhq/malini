<script lang="ts">
	import { untrack } from 'svelte';
	import type { JobOutput, JobRunsIn } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import { labDraft, labGuessTriggerId, type LabSavedDraft } from './lab-recipes';
	import { LAB_MANUAL_TRIGGER_ID, LAB_RUN_MODES, type LabJobSetup } from './lab-triggers';
	import LabChoiceMenu from './LabChoiceMenu.svelte';
	import LabRow from './LabRow.svelte';
	import LabRunsMode from './LabRunsMode.svelte';
	import LabTriggerButton from './LabTriggerButton.svelte';

	interface Props {
		text: string;
		title?: string | undefined;
		onsave: (draft: LabSavedDraft) => void;
		ondiscard: () => void;
	}

	let { text, title, onsave, ondiscard }: Props = $props();

	const DRAFTING_MS = 900;
	const EVENT_RUNS_IN: readonly Readonly<{ value: JobRunsIn; label: string }>[] = [
		{ value: 'workstream', label: 'The workstream it fires in' },
		{ value: 'new-workstream', label: 'A new workstream' },
	];

	const parsed = untrack(() => labDraft(text));
	const triggerId = untrack(() => labGuessTriggerId(text));
	const quote = untrack(() => [
		{ text: '“', strong: false },
		{ text: parsed.lead, strong: true },
		{ text: `${text.trim().slice(parsed.lead.length)}”`, strong: false },
	]);
	let drafting = $state(true);
	let name = $state(untrack(() => title) ?? parsed.name);
	let steps = $state<string[]>([...parsed.steps]);
	let setup = $state<LabJobSetup>({
		triggerId,
		mode: 'ask',
		runsIn: 'workstream',
		output: parsed.output ?? 'none',
	});

	const modeHint = $derived(
		setup.mode === 'ask'
			? 'New jobs ask first. Let it run on its own once you trust it.'
			: (LAB_RUN_MODES.find((option) => option.value === setup.mode)?.hint ?? ''),
	);

	$effect(() => {
		const timer = setTimeout(() => (drafting = false), DRAFTING_MS);
		return () => clearTimeout(timer);
	});

	function onStep(index: number, value: string): void {
		steps[index] = value;
	}

	function onRemoveStep(index: number): void {
		steps.splice(index, 1);
	}

	function onSave(): void {
		onsave({
			name: name.trim() || 'New job',
			steps: steps.map((step) => step.trim()).filter(Boolean),
			setup: { ...setup },
		});
	}
</script>

<article
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-xl border-[0.5px]"
	aria-label="New job draft"
	aria-busy={drafting}
	data-testid="lab-draft"
>
	<header class="flex items-start gap-3 px-4 py-3">
		<div class="min-w-0 flex-1">
			<p class="text-fg-tertiary flex items-center gap-1.5 text-xs">
				<Icon name="sparkles" size={12} />
				{#if drafting}
					<ShimmerText text="Drafting a job from your words…" />
				{:else}
					Drafted from your words
				{/if}
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

	{#if drafting}
		<div class="flex flex-col gap-2 px-4 py-3" aria-hidden="true">
			{#each ['72%', '56%', '64%'] as width (width)}
				<Skeleton {width} height="36px" />
			{/each}
		</div>
	{:else}
		<LabRow title="When" description="What starts it. Malini read it from your words.">
			<LabTriggerButton {setup} jobName={name} onchange={(next) => (setup = next)} />
		</LabRow>

		<LabRow title="Steps" description="Malini writes these into the job's instructions." stacked>
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
									event.currentTarget instanceof HTMLInputElement
										? event.currentTarget.value
										: step,
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
		</LabRow>

		{#if parsed.tools.length > 0}
			<LabRow
				title="Uses"
				description="Through your Claude tools. Malini checks them on the first try."
			>
				{#each parsed.tools as tool (tool)}
					<span
						class="border-chip-border bg-chip text-fg-secondary inline-flex h-7 items-center gap-1.5 rounded-md border-[0.5px] px-2 text-xs"
					>
						<Icon name="plug" size={12} />
						{tool}
					</span>
				{/each}
			</LabRow>
		{/if}

		<LabRow title="Runs in" description="Where the agent works on it.">
			<LabChoiceMenu
				value={setup.runsIn ?? 'workstream'}
				options={setup.triggerId === LAB_MANUAL_TRIGGER_ID ? JOB_RUNS_IN_OPTIONS : EVENT_RUNS_IN}
				ariaLabel="Runs in"
				icon="branch"
				onchange={(runsIn: JobRunsIn) => (setup = { ...setup, runsIn })}
			/>
		</LabRow>

		<LabRow title="When it finishes" description="What Malini does with the changes.">
			<LabChoiceMenu
				value={setup.output ?? 'none'}
				options={JOB_OUTPUT_OPTIONS}
				ariaLabel="When it finishes"
				icon="pr-draft"
				onchange={(output: JobOutput) => (setup = { ...setup, output })}
			/>
		</LabRow>

		<LabRow title="Runs" description={modeHint}>
			<LabRunsMode
				value={setup.mode}
				label="How the new job runs"
				onchange={(mode) => (setup = { ...setup, mode })}
			/>
		</LabRow>

		<footer class="flex items-center justify-end gap-2 px-4 py-3">
			<Button variant="ghost" size="sm" onclick={ondiscard}>Discard</Button>
			<Button variant="secondary" size="sm">
				{#snippet leading()}
					<Icon name="play" size={12} />
				{/snippet}
				Try it once
			</Button>
			<Button
				variant="primary"
				size="sm"
				disabled={steps.every((step) => !step.trim())}
				onclick={onSave}
			>
				Save job
			</Button>
		</footer>
	{/if}
</article>
