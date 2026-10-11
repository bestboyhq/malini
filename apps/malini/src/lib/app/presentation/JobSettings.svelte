<script lang="ts">
	import { onMount } from 'svelte';
	import { JOBS_MAX_CONCURRENT_SETTING } from '$contract/jobs';
	import { MERGE_QUEUE_FIX_ATTEMPTS_SETTING } from '$contract/pull-requests';
	import { loadJobSettingsCommand } from '$lib/app/application/commands/load-job-settings.command';
	import { jobSettingsQuery } from '$lib/app/application/queries/job-settings.query.svelte';
	import JobSettingRow from './JobSettingRow.svelte';

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
		description="Background jobs malini runs at the same time, across every workstream."
		value={settings?.[JOBS_MAX_CONCURRENT_SETTING] ?? null}
	/>
	<JobSettingRow
		key={MERGE_QUEUE_FIX_ATTEMPTS_SETTING}
		label="Fix attempts before asking you"
		description="How often the merge queue retries the same failure before it stops and waits for you."
		value={settings?.[MERGE_QUEUE_FIX_ATTEMPTS_SETTING] ?? null}
	/>
</div>
