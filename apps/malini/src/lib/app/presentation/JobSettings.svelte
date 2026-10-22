<script lang="ts">
	import { onMount } from 'svelte';
	import { JOBS_MAX_CONCURRENT_SETTING } from '$contract/jobs';
	import {
		MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
		UPDATE_FROM_MAIN_TRIGGERS,
		UPDATE_FROM_MAIN_TRIGGER_SETTING,
		updateFromMainTrigger,
		type UpdateFromMainTrigger,
	} from '$contract/pull-requests';
	import { Select } from '$hyper-ui/components/select';
	import { loadJobSettingsCommand } from '$lib/app/application/commands/load-job-settings.command';
	import { saveJobSettingCommand } from '$lib/app/application/commands/save-job-setting.command';
	import { jobSettingsQuery } from '$lib/app/application/queries/job-settings.query.svelte';
	import JobSettingRow from './JobSettingRow.svelte';

	const UPDATE_TRIGGER_LABELS: Readonly<Record<UpdateFromMainTrigger, string>> = {
		'main-moves': 'When main moves',
		'workstream-opened': 'When you open the workstream',
		merging: 'Only when merging',
	};
	const updateTriggerOptions = UPDATE_FROM_MAIN_TRIGGERS.map((trigger) => ({
		value: trigger,
		label: UPDATE_TRIGGER_LABELS[trigger],
	}));

	const settings = $derived(jobSettingsQuery.data);

	onMount(() => {
		loadJobSettingsCommand();
	});
</script>

<div
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
>
	<JobSettingRow
		key={JOBS_MAX_CONCURRENT_SETTING}
		label="Jobs running at once"
		description="Background jobs Malini runs at the same time, across every workstream."
		value={settings?.[JOBS_MAX_CONCURRENT_SETTING] ?? null}
	/>
	<JobSettingRow
		key={MERGE_QUEUE_FIX_ATTEMPTS_SETTING}
		label="Fix attempts before asking you"
		description="How often the merge queue retries the same failure before it stops and waits for you."
		value={settings?.[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] ?? null}
	/>
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
		<div class="min-w-0">
			<h3 class="text-fg-default text-sm font-medium">Update from main</h3>
			<p class="text-fg-tertiary text-xs">
				When Malini merges main into your branches. Each update runs a job, so updating as main
				moves can start one in every workstream behind it.
			</p>
		</div>
		<Select
			ariaLabel="Update from main"
			value={settings?.[UPDATE_FROM_MAIN_TRIGGER_SETTING] ?? 'main-moves'}
			options={updateTriggerOptions}
			disabled={settings === null}
			onchange={(value) =>
				saveJobSettingCommand(UPDATE_FROM_MAIN_TRIGGER_SETTING, updateFromMainTrigger(value))}
		/>
	</div>
</div>
