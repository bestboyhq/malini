<script lang="ts">
	import { onMount } from 'svelte';
	import {
		isAgentlessAutomationBuiltin,
		isBrainAutomationBuiltin,
		isOneShotAutomationBuiltin,
		type AutomationDefinitionRecord,
	} from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { automationImproveHref } from '$shared/router/routes-hrefs';
	import { deleteAutomationDefinitionCommand } from '$lib/automations/application/commands/delete-automation-definition.command';
	import { loadAutomationScorecardCommand } from '$lib/automations/application/commands/load-automation-scorecard.command';
	import { resetAutomationDefinitionCommand } from '$lib/automations/application/commands/reset-automation-definition.command';
	import { updateAutomationSettingsCommand } from '$lib/automations/application/commands/update-automation-settings.command';
	import { automationActionStateQuery } from '$lib/automations/application/queries/automation-action-state.query.svelte';
	import { liveAutomationsQuery } from '$lib/automations/application/queries/live-automations.query.svelte';
	import { automationRunsForDefinitionQuery } from '$lib/automations/application/queries/automation-runs-for-definition.query.svelte';
	import { automationScorecardErrorQuery } from '$lib/automations/application/queries/automation-scorecard-error.query.svelte';
	import { automationScorecardQuery } from '$lib/automations/application/queries/automation-scorecard.query.svelte';
	import { automationSettingsStateQuery } from '$lib/automations/application/queries/automation-settings-state.query.svelte';
	import { isRunnableAutomation, takesThen } from '$lib/automations/domain/builtin-automations';
	import { asksYou } from '$lib/automations/domain/live-automations';
	import { scheduleOf } from '$lib/automations/domain/schedule';
	import { AUTOMATION_RUNS_IN_OPTIONS } from '../automation-definition-copy';
	import AutomationEditor from '../AutomationEditor.svelte';
	import AutomationRunList from '../AutomationRunList.svelte';
	import AutomationRunRow from '../AutomationRunRow.svelte';
	import AutomationRunTarget from '../AutomationRunTarget.svelte';
	import { PageSection } from '$hyper-ui/components/page-section';
	import ChoiceMenu from './ChoiceMenu.svelte';
	import AutomationBoundary from './AutomationBoundary.svelte';
	import AutomationScorecard from './AutomationScorecard.svelte';
	import SegmentedPicker from './SegmentedPicker.svelte';
	import SchedulePlaceMenu from './SchedulePlaceMenu.svelte';
	import SettingRow from './SettingRow.svelte';
	import TriggerButton from './TriggerButton.svelte';
	import {
		builtinTrigger,
		EVENT_RUNS_IN_OPTIONS,
		automationSentence,
		RUN_MODES,
		runModeHint,
		SCHEDULE_RUNS_IN_HINT,
		thenChoices,
		UPDATE_FROM_MAIN_THEN,
	} from './triggers';

	interface Props {
		automation: AutomationDefinitionRecord;
		automations: readonly AutomationDefinitionRecord[];
	}

	let { automation, automations }: Props = $props();

	const RECENT_RUNS = 10;
	const NOTHING = '';
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';

	let nowMs = $state(Date.now());
	let confirming = $state<'delete' | 'reset' | null>(null);
	let choosingTarget = $state(false);

	const runsFor = $derived(automationRunsForDefinitionQuery.data);
	const actionState = $derived(automationActionStateQuery.data(automation.id));
	const settingsState = $derived(automationSettingsStateQuery.data(automation.id));
	const runs = $derived(runsFor(automation.id).slice(0, RECENT_RUNS));
	const asks = $derived(
		liveAutomationsQuery.data.filter(
			(entry) => asksYou(entry) && entry.run?.definitionId === automation.id,
		),
	);
	const fixed = $derived(builtinTrigger(automation));
	const runnable = $derived(isRunnableAutomation(automation));
	const thenable = $derived(takesThen(automation));
	const agentless = $derived(isAgentlessAutomationBuiltin(automation.builtin));
	const schedule = $derived(scheduleOf(automation.trigger?.when));
	const scorecardFor = $derived(automationScorecardQuery.data);
	const scorecard = $derived(scorecardFor(automation, nowMs));
	const scorecardError = $derived(automationScorecardErrorQuery.data(automation.id));
	const thenName = $derived(
		automations.find((other) => other.id === automation.thenAutomationId)?.name ?? null,
	);
	const thenOptions = $derived([
		{ value: NOTHING, label: 'Nothing' },
		...thenChoices(automations, automation.id),
	]);
	const editorKey = $derived(
		JSON.stringify([
			automation.id,
			automation.name,
			automation.instructions,
			automation.model,
			automation.effort,
			automation.skills,
		]),
	);

	onMount(() => {
		if (isOneShotAutomationBuiltin(automation.builtin))
			loadAutomationScorecardCommand(automation.id);
	});

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onWhen(when: string | null): void {
		updateAutomationSettingsCommand(automation, {
			trigger: when === null ? null : { when, mode: automation.trigger?.mode ?? 'ask' },
		});
	}

	function onConfirm(): void {
		if (confirming === 'delete') deleteAutomationDefinitionCommand(automation.id);
		if (confirming === 'reset') resetAutomationDefinitionCommand(automation.id);
		confirming = null;
	}
</script>

<PageSection title={automation.name} description={automationSentence(automation, thenName)}>
	{#snippet actions()}
		<div class="flex shrink-0 items-center gap-1.5">
			{#if confirming}
				<span class="text-fg-secondary text-xs">
					{confirming === 'delete' ? 'Delete this automation?' : 'Undo your edits?'}
				</span>
				<Button
					variant={confirming === 'delete' ? 'danger' : 'secondary'}
					size="sm"
					ariaLabel={confirming === 'delete'
						? `Confirm deleting ${automation.name}`
						: `Confirm resetting ${automation.name}`}
					onclick={onConfirm}
				>
					{confirming === 'delete' ? 'Delete' : 'Reset'}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => (confirming = null)}>Keep</Button>
			{:else}
				{#if automation.builtin !== null}
					<Button
						variant="ghost"
						size="sm"
						ariaLabel={`Reset ${automation.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'reset')}
					>
						Reset
					</Button>
				{:else}
					<Button
						variant="danger-ghost"
						size="sm"
						ariaLabel={`Delete ${automation.name}`}
						disabled={actionState.busy}
						onclick={() => (confirming = 'delete')}
					>
						Delete
					</Button>
				{/if}
				{#if isOneShotAutomationBuiltin(automation.builtin)}
					<Button variant="primary" size="sm" href={automationImproveHref(automation.id)}>
						{#snippet leading()}
							<Icon name="sparkles" size={12} />
						{/snippet}
						Improve
					</Button>
				{/if}
				{#if runnable}
					<Button
						variant="primary"
						size="sm"
						ariaLabel={`Run ${automation.name}`}
						ariaExpanded={choosingTarget}
						loading={actionState.busy}
						onclick={() => (choosingTarget = !choosingTarget)}
					>
						{#snippet leading()}
							<Icon name="play" size={12} />
						{/snippet}
						Run
					</Button>
				{/if}
			{/if}
		</div>
	{/snippet}

	{#if actionState.error}
		<p
			class="border-error-content/20 bg-error text-error-content rounded-xl border-[0.5px] px-4 py-3 text-xs"
			role="alert"
		>
			{actionState.error}
		</p>
	{/if}

	{#if scorecardError}
		<p
			class="border-error-content/20 bg-error text-error-content rounded-xl border-[0.5px] px-4 py-3 text-xs"
			role="alert"
		>
			{scorecardError}
		</p>
	{/if}

	{#if asks.length > 0}
		<Well title="Needs you">
			<div class={[ROWS, 'p-1']}>
				<AutomationRunList entries={asks} {nowMs} asksHere />
			</div>
		</Well>
	{/if}

	{#if scorecard && isOneShotAutomationBuiltin(automation.builtin)}
		<AutomationScorecard
			automationName={automation.name}
			builtin={automation.builtin}
			card={scorecard}
		/>
	{/if}

	{#if choosingTarget && runnable}
		<Well title="Run it now">
			<div class={ROWS}>
				<AutomationRunTarget definition={automation} onclose={() => (choosingTarget = false)} />
			</div>
		</Well>
	{/if}

	<AutomationBoundary {automation} {automations} disabled={settingsState.busy} />

	<Well title="How it runs">
		<div class={ROWS}>
			<SettingRow title="When" description={fixed ? 'Built into Malini.' : 'What starts it.'}>
				{#if fixed}
					<span class="text-fg-secondary flex items-center gap-1.5 text-xs">
						<Icon name={fixed.icon} size={14} />
						{fixed.label}
					</span>
				{:else}
					<TriggerButton
						when={automation.trigger?.when ?? null}
						automationName={automation.name}
						disabled={settingsState.busy}
						schedulable={!agentless}
						onpick={onWhen}
					/>
				{/if}
			</SettingRow>
			<SettingRow
				title="Runs"
				description={fixed
					? 'On its own, whenever it fires.'
					: automation.trigger === null
						? 'Only when you start it: type / in any chat.'
						: runModeHint(automation.trigger.mode)}
			>
				{#if !fixed && automation.trigger !== null}
					{@const trigger = automation.trigger}
					<SegmentedPicker
						value={trigger.mode}
						options={RUN_MODES}
						label={`How ${automation.name} runs`}
						disabled={settingsState.busy}
						onchange={(mode) =>
							updateAutomationSettingsCommand(automation, { trigger: { ...trigger, mode } })}
					/>
				{/if}
			</SettingRow>
			{#if schedule && automation.trigger && !isBrainAutomationBuiltin(automation.builtin)}
				{@const trigger = automation.trigger}
				<SettingRow title="Runs in" description={SCHEDULE_RUNS_IN_HINT}>
					<SchedulePlaceMenu
						{schedule}
						onchange={(when) =>
							updateAutomationSettingsCommand(automation, { trigger: { ...trigger, when } })}
					/>
				</SettingRow>
			{:else if automation.builtin === null}
				<SettingRow title="Runs in" description="Where the agent works on it.">
					<ChoiceMenu
						value={automation.runsIn}
						options={automation.trigger === null
							? AUTOMATION_RUNS_IN_OPTIONS
							: EVENT_RUNS_IN_OPTIONS}
						ariaLabel="Runs in"
						icon="branch"
						onchange={(runsIn) => updateAutomationSettingsCommand(automation, { runsIn })}
					/>
				</SettingRow>
			{/if}
			{#if thenable}
				<SettingRow
					title="Then"
					description="The automation that runs next, once this one succeeds."
				>
					<ChoiceMenu
						value={automation.thenAutomationId ?? NOTHING}
						options={thenOptions}
						ariaLabel="Then"
						icon="arrow-right"
						onchange={(thenAutomationId) =>
							updateAutomationSettingsCommand(automation, {
								thenAutomationId: thenAutomationId === NOTHING ? null : thenAutomationId,
							})}
					/>
				</SettingRow>
			{:else if automation.builtin === 'update-from-main'}
				<SettingRow title="Then" description="What runs next.">
					<span class="text-fg-secondary text-xs">{UPDATE_FROM_MAIN_THEN}</span>
				</SettingRow>
			{/if}
			{#if settingsState.error}
				<p class="text-error-content px-4 py-3 text-xs" role="alert">
					{settingsState.error}
				</p>
			{/if}
		</div>
	</Well>

	{#if runnable}
		<Well title="Recent runs" note={runs.length > 0 ? `${runs.length}` : undefined}>
			<div class={ROWS}>
				{#if runs.length > 0}
					<ul class="flex flex-col p-1" aria-label="Recent runs">
						{#each runs as run (run.id)}
							<li><AutomationRunRow {run} {nowMs} placeFirst /></li>
						{/each}
					</ul>
				{:else}
					<p class="text-fg-tertiary px-4 py-3 text-xs">
						No runs yet. Run it from here, or type / in any chat.
					</p>
				{/if}
			</div>
		</Well>
	{/if}

	{#if agentless}
		<Well title="What it does">
			<p class={[ROWS, 'text-fg-secondary px-4 py-3 text-xs leading-5']}>
				{automation.instructions}
			</p>
		</Well>
	{:else}
		<Well title="Instructions">
			<div class={[ROWS, 'p-4']}>
				{#key editorKey}
					<AutomationEditor definition={automation} />
				{/key}
			</div>
		</Well>
	{/if}
</PageSection>
