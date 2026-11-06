<script lang="ts">
	import type {
		AutomationDefinitionRecord,
		AutomationRunMode,
		AutomationRunRecord,
	} from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Icon } from '$hyper-ui/icons';
	import { automationHref } from '$shared/router/routes-hrefs';
	import { updateAutomationSettingsCommand } from '$lib/automations/application/commands/update-automation-settings.command';
	import { automationSettingsStateQuery } from '$lib/automations/application/queries/automation-settings-state.query.svelte';
	import { instructionsPreview } from '../automation-definition-copy';
	import { AUTOMATION_RUN_STATUS } from '../automation-run-status';
	import { automationRunTime } from '../automation-run-time';
	import { builtinTrigger, automationTriggerLook, runModeLabel, whenClause } from './triggers';

	interface Props {
		automation: AutomationDefinitionRecord;
		last: AutomationRunRecord | null;
		nowMs: number;
	}

	let { automation, last, nowMs }: Props = $props();

	let modeBeforeOff = $state<AutomationRunMode>('ask');

	const settingsState = $derived(automationSettingsStateQuery.data(automation.id));
	const look = $derived(automationTriggerLook(automation));
	const builtIn = $derived(builtinTrigger(automation) !== null);

	function onToggle(on: boolean): void {
		if (automation.trigger === null) return;
		if (on) {
			updateAutomationSettingsCommand(automation, {
				trigger: { ...automation.trigger, mode: modeBeforeOff },
			});
			return;
		}
		modeBeforeOff = automation.trigger.mode;
		updateAutomationSettingsCommand(automation, {
			trigger: { ...automation.trigger, mode: 'off' },
		});
	}
</script>

<article
	class="border-surface-50-border bg-surface-50 relative flex w-full flex-col rounded-xl border-[0.5px]"
	aria-label={automation.name}
	data-testid="automation-card"
>
	<Button
		bare
		href={automationHref(automation.id)}
		ariaLabel={`Set up ${automation.name}`}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2"
	/>
	<div class="pointer-events-none relative flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
		<div class="flex min-w-0 items-center gap-2">
			<span
				class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
				aria-hidden="true"
			>
				<Icon name={look.icon} size={13} />
			</span>
			<span class="text-fg-tertiary min-w-0 truncate text-xs">{whenClause(look)}</span>
		</div>
		<div class="flex flex-col gap-1">
			<h3 class="text-fg-default truncate text-sm font-semibold">{automation.name}</h3>
			<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">
				{instructionsPreview(automation.instructions)}
			</p>
			{#if settingsState.error}
				<p class="text-error-content text-xs" role="alert">{settingsState.error}</p>
			{/if}
		</div>
	</div>
	<div
		class="border-surface-50-border pointer-events-none relative flex h-11 items-center gap-2 border-t-[0.5px] px-4 text-xs"
	>
		{#if last}
			{@const status = AUTOMATION_RUN_STATUS[last.status]}
			<span class={['flex shrink-0 items-center gap-1', status.tone]}>
				<Icon name={status.icon} size={12} />
				{status.label}
			</span>
			<span class="text-fg-tertiary min-w-0 flex-1 truncate tabular-nums">
				{automationRunTime(last, nowMs)}
			</span>
		{:else}
			<span class="text-fg-tertiary min-w-0 flex-1 truncate">No runs yet</span>
		{/if}
		{#if builtIn}
			<span class="text-fg-tertiary shrink-0">Runs on its own</span>
		{:else if automation.trigger === null}
			<span class="text-fg-tertiary shrink-0">Runs when you run it</span>
		{:else}
			<span class="text-fg-tertiary shrink-0">{runModeLabel(automation.trigger.mode)}</span>
			<Switch
				checked={automation.trigger.mode !== 'off'}
				disabled={settingsState.busy}
				ariaLabel={automation.name}
				class="pointer-events-auto"
				onchange={onToggle}
			/>
		{/if}
	</div>
</article>
