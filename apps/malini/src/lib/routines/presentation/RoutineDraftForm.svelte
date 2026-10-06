<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { createRoutineDraftCommand } from '$lib/routines/application/commands/create-routine-draft.command';
	import { ExtensionRunTargetSelect } from '$lib/extensions/extensions.api';
	import { routineDraftSubmissionQuery } from '$lib/routines/application/queries/routine-draft-submission.query.svelte';
	import type { RoutineRun } from '$lib/routines/domain/routine';
	import { ROUTINE_WHEN_PHRASES } from '$lib/routines/domain/routine-when-phrase';
	import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
	import { validateRoutineWhenPhrase } from './routine-when-phrase';

	interface Props {
		suggestion?: RoutineSuggestion | null;
		onclearsuggestion?: () => void;
	}

	let { suggestion = null, onclearsuggestion }: Props = $props();

	const CUSTOM_TARGET = 'custom';

	const submission = $derived(routineDraftSubmissionQuery.data);

	let label = $state('');
	let when = $state<string>(ROUTINE_WHEN_PHRASES[0]);
	let target = $state(CUSTOM_TARGET);
	let customCommand = $state('');
	let argsJson = $state('[]');
	let inputJson = $state('{}');
	let localError = $state<string | null>(null);
	let seededSuggestionId = $state<string | null>(null);
	let acknowledgedDrafts = $state(0);

	const whenValidation = $derived(validateRoutineWhenPhrase(when));
	const whenOptions: SelectItem[] = ROUTINE_WHEN_PHRASES.map((phrase) => ({
		value: phrase,
		label: phrase,
	}));
	const submitError = $derived(localError ?? submission.error);

	const targetKind = $derived(
		target.startsWith('workflow:')
			? ('workflow' as const)
			: target.startsWith('command:')
				? ('command' as const)
				: ('custom' as const),
	);

	$effect(() => {
		if (!suggestion || suggestion.id === seededSuggestionId) return;
		seededSuggestionId = suggestion.id;
		const prompt = suggestion.evidence[0]?.text.trim();
		if (prompt && !label.trim()) label = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
	});

	$effect(() => {
		if (submission.created === acknowledgedDrafts) return;
		acknowledgedDrafts = submission.created;
		localError = null;
		label = '';
		customCommand = '';
		argsJson = '[]';
		inputJson = '{}';
		seededSuggestionId = null;
		onclearsuggestion?.();
	});

	function buildRun(): RoutineRun {
		if (targetKind === 'workflow') {
			return { workflow: target.slice('workflow:'.length), input: parseJsonObject(inputJson) };
		}
		const command =
			targetKind === 'command' ? target.slice('command:'.length) : customCommand.trim();
		if (!command) throw new Error('Name the command the routine should run.');
		return { command, args: parseJsonArray(argsJson) };
	}

	function onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (submission.busy) return;
		localError = null;
		if (!label.trim()) {
			localError = 'Give the draft a label.';
			return;
		}
		if (!whenValidation.ok) {
			localError = whenValidation.message;
			return;
		}
		let run: RoutineRun;
		try {
			run = buildRun();
		} catch (error) {
			localError = error instanceof Error ? error.message : String(error);
			return;
		}
		createRoutineDraftCommand({
			label: label.trim(),
			when,
			run,
			...(suggestion ? { suggestionId: suggestion.id, origin: 'suggested' as const } : {}),
		});
	}

	type WorkflowRunInput = Extract<RoutineRun, { workflow: string }>['input'];
	type CommandRunArgs = Extract<RoutineRun, { command: string }>['args'];

	function parseJsonObject(raw: string): WorkflowRunInput {
		if (!raw.trim()) return {};
		const parsed = parseJson(raw, 'Workflow input');
		if (!isJsonRecord(parsed)) {
			throw new Error('Workflow input must be a JSON object.');
		}
		return parsed;
	}

	function parseJsonArray(raw: string): CommandRunArgs {
		if (!raw.trim()) return [];
		const parsed = parseJson(raw, 'Arguments');
		if (!isJsonArray(parsed)) throw new Error('Arguments must be a JSON array.');
		return parsed;
	}

	function parseJson(raw: string, subject: string): unknown {
		try {
			return JSON.parse(raw);
		} catch {
			throw new Error(`${subject} is not valid JSON.`);
		}
	}

	function isJsonRecord(value: unknown): value is WorkflowRunInput {
		return (
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value) &&
			Object.values(value).every(isJsonValue)
		);
	}

	function isJsonArray(value: unknown): value is CommandRunArgs {
		return Array.isArray(value) && value.every(isJsonValue);
	}

	function isJsonValue(value: unknown): boolean {
		if (value === null) return true;
		if (Array.isArray(value)) return value.every(isJsonValue);
		if (typeof value === 'object') return Object.values(value).every(isJsonValue);
		return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
	}
</script>

<form class="space-y-3" data-testid="routine-draft-form" onsubmit={onSubmit}>
	{#if suggestion}
		<div
			class="border-surface-100-border bg-surface-100 flex items-center gap-2 rounded-lg border px-3 py-2"
			data-testid="routine-draft-suggestion-chip"
		>
			<p class="text-fg-secondary min-w-0 flex-1 truncate text-xs">
				Accepting a suggestion - the draft inherits its {suggestion.evidence.length}
				{suggestion.evidence.length === 1 ? 'prompt' : 'prompts'} as evidence.
			</p>
			<IconButton
				variant="ghost"
				size="sm"
				ariaLabel="Stop accepting this suggestion"
				data-testid="routine-draft-suggestion-clear"
				onclick={() => {
					seededSuggestionId = null;
					onclearsuggestion?.();
				}}
			>
				<Icon name="close" size={13} />
			</IconButton>
		</div>
	{/if}

	<TextInput
		bind:value={label}
		label="Label"
		placeholder="Start the frontend dev server"
		required
		data-testid="routine-draft-label"
	/>

	<Select
		bind:value={when}
		label="When"
		options={whenOptions}
		{...whenValidation.ok ? { hint: whenValidation.description } : {}}
		invalid={!whenValidation.ok}
		data-testid="routine-draft-when"
	/>
	{#if !whenValidation.ok}
		<p class="text-error-content text-xs" role="alert" data-testid="routine-draft-when-error">
			{whenValidation.message}
		</p>
	{/if}

	<ExtensionRunTargetSelect bind:value={target} customValue={CUSTOM_TARGET} />

	{#if targetKind === 'custom'}
		<TextInput
			bind:value={customCommand}
			label="Command"
			placeholder="malini.repository.refresh"
			data-testid="routine-draft-command"
		/>
	{/if}
	{#if targetKind === 'workflow'}
		<Textarea
			bind:value={inputJson}
			label="Workflow input (JSON object)"
			rows={2}
			textareaClass="font-mono text-xs"
			data-testid="routine-draft-input"
		/>
	{:else}
		<Textarea
			bind:value={argsJson}
			label="Arguments (JSON array)"
			rows={2}
			textareaClass="font-mono text-xs"
			data-testid="routine-draft-args"
		/>
	{/if}

	{#if submitError}
		<p class="text-error-content text-xs" role="alert" data-testid="routine-draft-error">
			{submitError}
		</p>
	{/if}

	<div>
		<Button
			type="submit"
			variant="secondary"
			size="sm"
			ariaLabel="Create the draft routine"
			loading={submission.busy}
			data-testid="routine-draft-create"
		>
			Create draft
		</Button>
	</div>
</form>
