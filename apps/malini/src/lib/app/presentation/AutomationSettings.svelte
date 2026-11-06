<script lang="ts">
	import { onMount } from 'svelte';
	import { AUTOMATIONS_MAX_CONCURRENT_SETTING } from '$contract/automations';
	import { MERGE_QUEUE_FIX_ATTEMPTS_SETTING } from '$contract/pull-requests';
	import { loadAutomationSettingsCommand } from '$lib/app/application/commands/load-automation-settings.command';
	import { automationSettingsQuery } from '$lib/app/application/queries/automation-settings.query.svelte';
	import AutomationSettingRow from './AutomationSettingRow.svelte';

	const settings = $derived(automationSettingsQuery.data);

	onMount(() => {
		loadAutomationSettingsCommand();
	});
</script>

<div
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
>
	<AutomationSettingRow
		key={AUTOMATIONS_MAX_CONCURRENT_SETTING}
		label="Automations running at once"
		description="Background automations Malini runs at the same time, across every workstream."
		value={settings?.[AUTOMATIONS_MAX_CONCURRENT_SETTING] ?? null}
	/>
	<AutomationSettingRow
		key={MERGE_QUEUE_FIX_ATTEMPTS_SETTING}
		label="Fix attempts before asking you"
		description="How often Malini retries the same failure while it ships before it stops and waits for you."
		value={settings?.[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] ?? null}
	/>
</div>
