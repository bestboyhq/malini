<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
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
	import { saveJobDefinitionCommand } from '$lib/jobs/application/commands/save-job-definition.command';
	import { jobFormSubmissionQuery } from '$lib/jobs/application/queries/job-form-submission.query.svelte';
	import {
		JOB_INSTRUCTIONS_MAX_LENGTH,
		JOB_NAME_MAX_LENGTH,
		isJobEffort,
		isJobOutput,
		isJobRunsIn,
	} from '$lib/jobs/domain/job-definition';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS, effortLabel } from './job-definition-copy';

	interface Props {
		definition: JobDefinitionRecord | null;
		oncancel: () => void;
	}

	let { definition, oncancel }: Props = $props();

	type JobDraft = {
		name: string;
		instructions: string;
		model: string;
		effort: string;
		runsIn: string;
		output: string;
	};

	let draft = $state<JobDraft>(startingDraft());
	let localError = $state<string | null>(null);

	const submission = $derived(jobFormSubmissionQuery.data);
	const catalog = $derived(modelCatalogQuery.data);
	const builtin = $derived(definition?.builtin != null);
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
	const submitError = $derived(localError ?? submission.error);

	function startingDraft(): JobDraft {
		return {
			name: definition?.name ?? '',
			instructions: definition?.instructions ?? '',
			model: definition?.model ?? DEFAULT_AGENT_MODEL,
			effort: definition?.effort ?? DEFAULT_AGENT_RUN_PROFILE.effort,
			runsIn: definition?.runsIn ?? 'workstream',
			output: definition?.output ?? 'none',
		};
	}

	function draftEffort(): AgentReasoningEffort {
		return isJobEffort(draft.effort) ? draft.effort : DEFAULT_AGENT_RUN_PROFILE.effort;
	}

	function onModelChange(model: string): void {
		draft.effort = normalizeReasoningEffort(effortsForModel(catalog, model), draftEffort());
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
		saveJobDefinitionCommand({
			...(definition ? { id: definition.id } : {}),
			name,
			instructions,
			model: draft.model,
			effort: normalizeReasoningEffort(efforts, draftEffort()),
			runsIn: isJobRunsIn(draft.runsIn) ? draft.runsIn : 'workstream',
			output: isJobOutput(draft.output) ? draft.output : 'none',
		});
	}
</script>

<form class="space-y-3" aria-labelledby="job-form-heading" onsubmit={onSubmit}>
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
		placeholder="What the agent should do, in plain words. It works in its own chat."
		rows={5}
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
		<Select
			bind:value={draft.effort}
			label="Effort"
			options={effortOptions}
			disabled={effortOptions.length === 0}
			{...effortOptions.length === 0
				? { hint: `${catalogModelLabel(catalog, draft.model)} takes no effort setting` }
				: {}}
		/>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<Select
			bind:value={draft.runsIn}
			label="Runs in"
			options={[...JOB_RUNS_IN_OPTIONS]}
			disabled={builtin}
		/>
		<Select
			bind:value={draft.output}
			label="When it finishes"
			options={[...JOB_OUTPUT_OPTIONS]}
			disabled={builtin}
		/>
	</div>
	{#if builtin}
		<p class="text-fg-tertiary text-xs">
			Built-in jobs always run in the workstream the merge queue is shipping, and leave shipping to
			it.
		</p>
	{/if}

	{#if submitError}
		<p class="text-error-content text-xs" role="alert">{submitError}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button type="submit" variant="secondary" size="sm" loading={submission.busy}>
			{definition ? 'Save changes' : 'Create job'}
		</Button>
		{#if definition}
			<Button variant="ghost" size="sm" onclick={oncancel}>Cancel</Button>
		{/if}
	</div>
</form>
