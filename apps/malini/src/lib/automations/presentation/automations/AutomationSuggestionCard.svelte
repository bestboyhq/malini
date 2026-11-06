<script lang="ts">
	import { tick } from 'svelte';
	import type { AutomationRunMode, AutomationSuggestionRecord } from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { automationHref } from '$shared/router/routes-hrefs';
	import {
		DEFAULT_AGENT_MODEL,
		DEFAULT_AGENT_RUN_PROFILE,
		DEFAULT_PROVIDER_ID,
	} from '$shared/providers/providers.api';
	import { acceptAutomationSuggestionCommand } from '$lib/automations/application/commands/accept-automation-suggestion.command';
	import { dismissAutomationSuggestionCommand } from '$lib/automations/application/commands/dismiss-automation-suggestion.command';
	import { automationActionStateQuery } from '$lib/automations/application/queries/automation-action-state.query.svelte';
	import { automationDefinitionByIdQuery } from '$lib/automations/application/queries/automation-definition-by-id.query.svelte';
	import SegmentedPicker from './SegmentedPicker.svelte';
	import { RUN_MODES, runModeLabel, triggerFor } from './triggers';

	interface Props {
		suggestion: AutomationSuggestionRecord;
	}

	let { suggestion }: Props = $props();

	const EDIT_MODES = RUN_MODES.filter(({ value }) => value !== 'off');
	const MERGES = new Intl.ListFormat('en', { type: 'conjunction' });

	let editing = $state(false);
	let name = $state('');
	let instructions = $state('');
	let mode = $state<AutomationRunMode>('ask');
	let nameInput = $state<HTMLInputElement | null>(null);

	const actionState = $derived(automationActionStateQuery.data(suggestion.id));
	const saved = $derived(suggestion.status === 'accepted');
	const automation = $derived(automationDefinitionByIdQuery.data(suggestion.definitionId));
	const changing = $derived(editing && !saved);
	const when = $derived(triggerFor(automation?.trigger?.when ?? suggestion.when).label);
	const does = $derived(automation?.instructions ?? suggestion.instructions);
	const runs = $derived(runModeLabel(automation?.trigger?.mode ?? 'ask'));
	const why = $derived(askedAfter(suggestion));
	const canSave = $derived(!changing || (name.trim().length > 0 && instructions.trim().length > 0));

	function askedAfter({ asks }: AutomationSuggestionRecord): string {
		const numbers = asks.map(({ pullRequestNumber }) => pullRequestNumber);
		return numbers.every((number) => number !== null)
			? `You asked this after ${MERGES.format([...numbers].sort((a, b) => a - b).map((number) => `#${number}`))} merged.`
			: `You asked this after ${asks.length} merges.`;
	}

	async function edit(): Promise<void> {
		name = suggestion.name;
		instructions = suggestion.instructions;
		mode = 'ask';
		editing = true;
		await tick();
		nameInput?.focus();
	}

	function save(): void {
		if (!changing) {
			acceptAutomationSuggestionCommand(suggestion);
			return;
		}
		acceptAutomationSuggestionCommand(suggestion, {
			name: name.trim(),
			instructions: instructions.trim(),
			provider: DEFAULT_PROVIDER_ID,
			model: DEFAULT_AGENT_MODEL,
			effort: DEFAULT_AGENT_RUN_PROFILE.effort,
			runsIn: 'new-workstream',
			trigger: { when: suggestion.when, mode },
		});
	}
</script>

<section
	class="w-full"
	aria-label="Suggested automation"
	aria-busy={actionState.busy}
	data-testid="automation-suggestion"
	data-suggestion-id={suggestion.id}
>
	<dl
		class="border-surface-50-border bg-surface-50 grid grid-cols-[4rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 rounded-xl border-[0.5px] px-4 py-3 text-sm"
	>
		{#if changing}
			<dt class="text-fg-tertiary text-xs">Name</dt>
			<dd>
				<TextInput
					bind:value={name}
					bind:element={nameInput}
					bare
					ariaLabel="Automation name"
					class="-my-1 h-7 w-full"
					inputClass="text-fg-default text-sm"
				/>
			</dd>
		{/if}
		<dt class="text-fg-tertiary text-xs">When</dt>
		<dd class="text-fg-default">{when}</dd>
		<dt class="text-fg-tertiary text-xs">Does</dt>
		<dd class="text-fg-default">
			{#if changing}
				<Textarea
					bind:value={instructions}
					bare
					autoGrow
					rows={1}
					ariaLabel="What the automation does"
					textareaClass="-my-0.5 p-0 text-sm leading-6"
				/>
			{:else}
				<p class="leading-6 whitespace-pre-line">{does}</p>
			{/if}
		</dd>
		<dt class="text-fg-tertiary text-xs">Runs</dt>
		<dd class="text-fg-default">
			{#if changing}
				<SegmentedPicker
					value={mode}
					options={EDIT_MODES}
					label="How the automation runs"
					onchange={(next) => (mode = next)}
				/>
			{:else}
				{runs}, in a new workstream
			{/if}
		</dd>
	</dl>

	<div class="px-5">
		<div
			class="border-surface-100-border bg-surface-100 flex h-9 items-center gap-2 rounded-b-xl border-x-[0.5px] border-b-[0.5px] pr-1.5 pl-3 text-xs"
		>
			{#if saved}
				<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
					<Icon name="check" size={12} />
					Saved as an automation
				</span>
				{#if suggestion.definitionId}
					<Button
						variant="ghost"
						size="sm"
						class="ml-auto"
						href={automationHref(suggestion.definitionId)}
					>
						Open
					</Button>
				{/if}
			{:else}
				<Tooltip content={why} placement="bottom">
					<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
						<Icon name="sparkles" size={12} />
						Suggested automation
					</span>
				</Tooltip>
				<div class="ml-auto flex shrink-0 items-center gap-1">
					{#if changing}
						<Button
							variant="ghost"
							size="sm"
							disabled={actionState.busy}
							onclick={() => (editing = false)}
						>
							Cancel
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							disabled={actionState.busy}
							data-testid="automation-suggestion-dismiss"
							onclick={() => dismissAutomationSuggestionCommand(suggestion.id)}
						>
							Not now
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={actionState.busy}
							data-testid="automation-suggestion-edit"
							onclick={edit}
						>
							Edit
						</Button>
					{/if}
					<Button
						variant="primary"
						size="sm"
						loading={actionState.busy}
						disabled={!canSave}
						data-testid="automation-suggestion-accept"
						onclick={save}
					>
						Save it
					</Button>
				</div>
			{/if}
		</div>
	</div>

	{#if actionState.error}
		<p class="text-error-content mt-1.5 px-1 text-xs" role="alert">{actionState.error}</p>
	{/if}
</section>
