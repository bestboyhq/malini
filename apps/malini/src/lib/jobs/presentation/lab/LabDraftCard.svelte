<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
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

{#snippet row(label: string, body: Snippet)}
	<div
		class="border-surface-50-border grid grid-cols-[64px_1fr] items-start gap-3 border-t-[0.5px] px-5 py-3"
	>
		<span class="text-fg-tertiary pt-1.5 text-xs font-medium">{label}</span>
		<div class="flex min-w-0 flex-wrap items-center gap-2">{@render body()}</div>
	</div>
{/snippet}

<article
	class="border-surface-50-border bg-surface-50 overflow-hidden rounded-2xl border-[0.5px]"
	aria-label="New job draft"
	aria-busy={drafting}
	data-testid="lab-draft"
>
	<header class="flex items-start gap-3 px-5 pt-4 pb-3">
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
		<div class="flex flex-col gap-2 px-5 pt-1 pb-5" aria-hidden="true">
			{#each ['72%', '56%', '64%'] as width (width)}
				<Skeleton {width} height="36px" />
			{/each}
		</div>
	{:else}
		{#snippet whenBody()}
			<LabTriggerButton {setup} jobName={name} onchange={(next) => (setup = next)} />
		{/snippet}
		{@render row('When', whenBody)}

		{#snippet doBody()}
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
		{/snippet}
		{@render row('Do', doBody)}

		{#if parsed.tools.length > 0}
			{#snippet usesBody()}
				{#each parsed.tools as tool (tool)}
					<span
						class="border-chip-border bg-chip text-fg-secondary inline-flex h-7 items-center gap-1.5 rounded-md border-[0.5px] px-2 text-xs"
					>
						<Icon name="plug" size={12} />
						{tool}
					</span>
				{/each}
				<span class="text-fg-tertiary text-xs">
					Through your Claude tools. Malini checks them on the first try.
				</span>
			{/snippet}
			{@render row('Uses', usesBody)}
		{/if}

		{#snippet whereBody()}
			<LabChoiceMenu
				value={setup.runsIn ?? 'workstream'}
				options={setup.triggerId === LAB_MANUAL_TRIGGER_ID ? JOB_RUNS_IN_OPTIONS : EVENT_RUNS_IN}
				ariaLabel="Runs in"
				icon="branch"
				onchange={(runsIn: JobRunsIn) => (setup = { ...setup, runsIn })}
			/>
			<span class="text-fg-tertiary text-xs">then</span>
			<LabChoiceMenu
				value={setup.output ?? 'none'}
				options={JOB_OUTPUT_OPTIONS}
				ariaLabel="When it finishes"
				icon="pr-draft"
				onchange={(output: JobOutput) => (setup = { ...setup, output })}
			/>
		{/snippet}
		{@render row('Where', whereBody)}

		{#snippet runsBody()}
			<LabRunsMode
				value={setup.mode}
				label="How the new job runs"
				onchange={(mode) => (setup = { ...setup, mode })}
			/>
			<span class="text-fg-tertiary min-w-0 text-xs">{modeHint}</span>
		{/snippet}
		{@render row('Runs', runsBody)}

		<footer class="border-surface-50-border flex items-center gap-2 border-t-[0.5px] px-5 py-3">
			<p class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">
				Malini writes these steps into the job's instructions.
			</p>
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
