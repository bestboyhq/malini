<script lang="ts">
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Select, type SelectOption } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Textarea } from '$hyper-ui/components/textarea';
	import {
		DEFAULT_AGENT_RUN_PROFILE,
		type AgentReasoningEffort,
		type ModelSelection,
		allProviderModels,
		catalogModelLabel,
		effortsForModel,
		modelSelectionValue,
		normalizeReasoningEffort,
		parseModelSelectionValue,
		providerGroupsQuery,
		providerSelectOptions,
	} from '$shared/providers/providers.api';
	import { saveJobDefinitionCommand } from '$lib/jobs/application/commands/save-job-definition.command';
	import { jobFormSubmissionQuery } from '$lib/jobs/application/queries/job-form-submission.query.svelte';
	import {
		JOB_INSTRUCTIONS_MAX_LENGTH,
		JOB_NAME_MAX_LENGTH,
		isJobEffort,
	} from '$lib/jobs/domain/job-definition';
	import { SkillsField } from '$lib/skills/skills.api';
	import { effortLabel } from './job-definition-copy';

	interface Props {
		definition: JobDefinitionRecord;
	}

	let { definition }: Props = $props();

	type JobDraft = {
		name: string;
		instructions: string;
		provider: string;
		model: string;
		effort: string;
		skills: string[];
	};

	let draft = $state<JobDraft>(startingDraft());
	let localError = $state<string | null>(null);

	const submission = $derived(jobFormSubmissionQuery.data);
	const groups = $derived(providerGroupsQuery.data);
	const catalog = $derived(allProviderModels(groups));
	const builtin = $derived(definition.builtin);
	const thinks = $derived(!isAutomaticJobBuiltin(builtin));
	const efforts = $derived(effortsForModel(catalog, draft.model));
	const selection = $derived<ModelSelection>({ provider: draft.provider, model: draft.model });
	const modelOptions = $derived(providerSelectOptions(groups, selection));
	const effortOptions: SelectOption[] = $derived(
		efforts.map((effort) => ({ value: effort, label: effortLabel(effort) })),
	);
	const dirty = $derived(differs(startingDraft(), draft));
	const submitError = $derived(localError ?? submission.error);

	function startingDraft(): JobDraft {
		return {
			name: definition.name,
			instructions: definition.instructions,
			provider: definition.provider,
			model: definition.model,
			effort: definition.effort,
			skills: [...definition.skills],
		};
	}

	function differs(left: JobDraft, right: JobDraft): boolean {
		return (
			left.name !== right.name.trim() ||
			left.instructions !== right.instructions.trim() ||
			left.provider !== right.provider ||
			left.model !== right.model ||
			left.effort !== right.effort ||
			left.skills.join('\n') !== right.skills.join('\n')
		);
	}

	function draftEffort(): AgentReasoningEffort {
		return isJobEffort(draft.effort) ? draft.effort : DEFAULT_AGENT_RUN_PROFILE.effort;
	}

	function onModelChange(value: string): void {
		const next = parseModelSelectionValue(value, selection);
		draft.provider = next.provider;
		draft.model = next.model;
		draft.effort = normalizeReasoningEffort(effortsForModel(catalog, next.model), draftEffort());
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
		saveJobDefinitionCommand({
			id: definition.id,
			name,
			instructions,
			provider: draft.provider,
			model: draft.model,
			effort: thinks ? normalizeReasoningEffort(efforts, draftEffort()) : draftEffort(),
			runsIn: definition.runsIn,
			skills: thinks ? [...draft.skills] : [],
		});
	}
</script>

<form
	class="flex flex-col gap-4"
	aria-label={`Edit ${definition.name}`}
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
			value={modelSelectionValue(selection)}
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
		<SkillsField value={draft.skills} onchange={(skills) => (draft.skills = skills)} />
	{/if}

	{#if submitError}
		<p class="text-error-content text-xs" role="alert">{submitError}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button type="submit" variant="secondary" size="sm" loading={submission.busy} disabled={!dirty}>
			Save changes
		</Button>
		{#if dirty}
			<Button variant="ghost" size="sm" onclick={onDiscard}>Discard</Button>
		{/if}
	</div>
</form>
