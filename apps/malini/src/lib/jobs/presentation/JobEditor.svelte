<script lang="ts">
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Select, type SelectOption } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Textarea } from '$hyper-ui/components/textarea';
	import {
		DEFAULT_AGENT_MODEL,
		DEFAULT_AGENT_RUN_PROFILE,
		type AgentReasoningEffort,
		catalogModelLabel,
		effortsForModel,
		modelCatalogQuery,
		normalizeReasoningEffort,
	} from '$shared/providers/providers.api';
	import { createJobDefinitionCommand } from '$lib/jobs/application/commands/create-job-definition.command';
	import { saveJobDefinitionCommand } from '$lib/jobs/application/commands/save-job-definition.command';
	import { jobFormSubmissionQuery } from '$lib/jobs/application/queries/job-form-submission.query.svelte';
	import {
		JOB_INSTRUCTIONS_MAX_LENGTH,
		JOB_NAME_MAX_LENGTH,
		isJobEffort,
		isJobOutput,
		isJobRunsIn,
	} from '$lib/jobs/domain/job-definition';
	import { SkillPresetSelect } from '$lib/skills/skills.api';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS, effortLabel } from './job-definition-copy';

	interface Props {
		definition: JobDefinitionRecord | null;
	}

	let { definition }: Props = $props();

	type JobDraft = {
		name: string;
		instructions: string;
		model: string;
		effort: string;
		runsIn: string;
		output: string;
		skillPresetId: string | null;
	};

	let draft = $state<JobDraft>(startingDraft());
	let localError = $state<string | null>(null);

	const submission = $derived(jobFormSubmissionQuery.data);
	const catalog = $derived(modelCatalogQuery.data);
	const builtin = $derived(definition?.builtin ?? null);
	const thinks = $derived(!isAutomaticJobBuiltin(builtin));
	const efforts = $derived(effortsForModel(catalog, draft.model));
	const modelOptions: SelectOption[] = $derived([
		...catalog.map((model) => ({ value: model.id, label: catalogModelLabel(catalog, model.id) })),
		...(catalog.some((model) => model.id === draft.model)
			? []
			: [{ value: draft.model, label: catalogModelLabel(catalog, draft.model) }]),
	]);
	const effortOptions: SelectOption[] = $derived(
		efforts.map((effort) => ({ value: effort, label: effortLabel(effort) })),
	);
	const dirty = $derived(definition === null || differs(startingDraft(), draft));
	const submitError = $derived(localError ?? submission.error);

	function startingDraft(): JobDraft {
		return {
			name: definition?.name ?? '',
			instructions: definition?.instructions ?? '',
			model: definition?.model ?? DEFAULT_AGENT_MODEL,
			effort: definition?.effort ?? DEFAULT_AGENT_RUN_PROFILE.effort,
			runsIn: definition?.runsIn ?? 'workstream',
			output: definition?.output ?? 'none',
			skillPresetId: definition?.skillPresetId ?? null,
		};
	}

	function differs(left: JobDraft, right: JobDraft): boolean {
		return (
			left.name !== right.name.trim() ||
			left.instructions !== right.instructions.trim() ||
			left.model !== right.model ||
			left.effort !== right.effort ||
			left.runsIn !== right.runsIn ||
			left.output !== right.output ||
			left.skillPresetId !== right.skillPresetId
		);
	}

	function draftEffort(): AgentReasoningEffort {
		return isJobEffort(draft.effort) ? draft.effort : DEFAULT_AGENT_RUN_PROFILE.effort;
	}

	function onModelChange(model: string): void {
		draft.effort = normalizeReasoningEffort(effortsForModel(catalog, model), draftEffort());
	}

	function onDiscard(): void {
		draft = startingDraft();
		localError = null;
	}

	function onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (submission.busy) return;
		const name = draft.name.trim();
		const instructions = draft.instructions.trim();
		if (!name) {
			localError = 'Give the job a name.';
			return;
		}
		if (!instructions) {
			localError = 'Tell the agent what the job does.';
			return;
		}
		localError = null;
		const fields = {
			name,
			instructions,
			model: draft.model,
			effort: thinks ? normalizeReasoningEffort(efforts, draftEffort()) : draftEffort(),
			runsIn: isJobRunsIn(draft.runsIn) ? draft.runsIn : 'workstream',
			output: isJobOutput(draft.output) ? draft.output : 'none',
			skillPresetId: thinks ? draft.skillPresetId : null,
		};
		if (definition) saveJobDefinitionCommand({ id: definition.id, ...fields });
		else createJobDefinitionCommand(fields);
	}
</script>

<form
	class="flex flex-col gap-4"
	aria-label={definition ? `Edit ${definition.name}` : 'New job'}
	data-testid="job-editor"
	onsubmit={onSubmit}
>
	<TextInput
		bind:value={draft.name}
		label="Name"
		placeholder="Update the changelog"
		maxlength={JOB_NAME_MAX_LENGTH}
		required
	/>

	<Textarea
		bind:value={draft.instructions}
		label="Instructions"
		placeholder="What the agent should do, in plain words. It works in its own chat in the workstream."
		rows={8}
		maxlength={JOB_INSTRUCTIONS_MAX_LENGTH}
		autoGrow
		required
	/>

	<div class="grid grid-cols-2 gap-3">
		<Select
			bind:value={draft.model}
			label="Model"
			options={modelOptions}
			onchange={onModelChange}
		/>
		{#if thinks}
			<Select
				bind:value={draft.effort}
				label="Effort"
				options={effortOptions}
				disabled={effortOptions.length === 0}
				{...effortOptions.length === 0
					? { hint: `${catalogModelLabel(catalog, draft.model)} takes no effort setting` }
					: {}}
			/>
		{/if}
	</div>

	{#if thinks}
		<SkillPresetSelect
			value={draft.skillPresetId}
			onchange={(presetId) => (draft.skillPresetId = presetId)}
		/>
	{/if}

	{#if builtin === null}
		<div class="grid grid-cols-2 gap-3">
			<Select bind:value={draft.runsIn} label="Runs in" options={[...JOB_RUNS_IN_OPTIONS]} />
			<Select
				bind:value={draft.output}
				label="When it finishes"
				options={[...JOB_OUTPUT_OPTIONS]}
			/>
		</div>
	{/if}

	{#if submitError}
		<p class="text-error-content text-xs" role="alert">{submitError}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button
			type="submit"
			variant={definition ? 'secondary' : 'primary'}
			size="sm"
			loading={submission.busy}
			disabled={!dirty}
		>
			{definition ? 'Save changes' : 'Create job'}
		</Button>
		{#if definition && dirty}
			<Button variant="ghost" size="sm" onclick={onDiscard}>Discard</Button>
		{/if}
	</div>
</form>
