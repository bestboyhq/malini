<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { Well } from '$hyper-ui/components/well';
	import { applyAutomationDefaultsCommand } from '$lib/app/application/commands/apply-automation-defaults.command';
	import { automationDefaultsQuery } from '$lib/app/application/queries/automation-defaults.query.svelte';
	import {
		RECOMMENDED,
		UPDATE_FROM_MAIN_MODES,
		type AutomationDefaults,
		type DefaultsChoice,
	} from '$lib/app/domain/automation-defaults';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import {
		DEFAULT_SWITCHES,
		UPDATE_FROM_MAIN_DETAILS,
		UPDATE_FROM_MAIN_LABELS,
		switchDetail,
	} from './automation-defaults-copy';
	import ChoiceSwitch from './settings/ChoiceSwitch.svelte';

	const CHOICES: readonly DefaultsChoice[] = ['recommended', 'custom'];
	const CHOICE_LABELS: Readonly<Record<DefaultsChoice, string>> = {
		recommended: 'Recommended',
		custom: 'Custom',
	};

	const defaults = $derived(automationDefaultsQuery.data);
	const idPrefix = $props.id();

	onMount(() => {
		loadAutomationsCommand();
		return watchAutomationsHook();
	});

	function change(patch: Partial<AutomationDefaults>): void {
		applyAutomationDefaultsCommand({ ...defaults.live, ...patch });
	}

	function choose(choice: DefaultsChoice): void {
		if (choice === 'recommended') applyAutomationDefaultsCommand(RECOMMENDED);
	}
</script>

<Well title="Defaults">
	{#snippet trailing()}
		<ChoiceSwitch
			label="Defaults"
			choices={CHOICES}
			labels={CHOICE_LABELS}
			selected={defaults.choice}
			onchoose={choose}
		/>
	{/snippet}
	<div
		class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
	>
		{#each DEFAULT_SWITCHES as item (item.key)}
			{@const labelId = `${idPrefix}-${item.key}`}
			{@const settingUp = item.key === 'brain' && defaults.settingUpBrain}
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
				<div class="min-w-0">
					<h3 id={labelId} class="text-fg-default text-sm font-medium">{item.title}</h3>
					<p class="text-fg-tertiary text-xs">{switchDetail(item)}</p>
				</div>
				<Switch
					checked={defaults.live[item.key] || settingUp}
					disabled={!defaults.ready || settingUp}
					labelledBy={labelId}
					onchange={(checked) => change({ [item.key]: checked })}
				/>
			</div>
		{/each}
		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
			<div class="min-w-0">
				<h3 class="text-fg-default text-sm font-medium">Update from main</h3>
				<p class="text-fg-tertiary text-xs">
					{UPDATE_FROM_MAIN_DETAILS[defaults.live.updateFromMain]}
				</p>
			</div>
			<ChoiceSwitch
				label="Update from main"
				choices={UPDATE_FROM_MAIN_MODES}
				labels={UPDATE_FROM_MAIN_LABELS}
				selected={defaults.live.updateFromMain}
				onchoose={(updateFromMain) => change({ updateFromMain })}
			/>
		</div>
	</div>
</Well>
