<script lang="ts">
	import { TextInput } from '$hyper-ui/components/text-input';
	import { saveJobSettingCommand } from '$lib/app/application/commands/save-job-setting.command';
	import {
		JOB_SETTING_BOUNDS,
		jobSettingFromInput,
		type JobSettingKey,
	} from '$lib/app/domain/job-settings';

	interface Props {
		key: JobSettingKey;
		label: string;
		description: string;
		value: number | null;
	}

	let { key, label, description, value }: Props = $props();

	let draft = $state<string | number>('');

	const bounds = $derived(JOB_SETTING_BOUNDS[key]);

	$effect(() => {
		draft = value === null ? '' : String(value);
	});

	function onCommit(event: Event): void {
		if (value === null || !(event.currentTarget instanceof HTMLInputElement)) return;
		const next = jobSettingFromInput(key, event.currentTarget.value, value);
		draft = String(next);
		saveJobSettingCommand(key, next);
	}
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
	<div class="min-w-0">
		<h3 class="text-fg-default text-sm font-medium">{label}</h3>
		<p class="text-fg-tertiary text-xs">{description} {bounds.min} to {bounds.max}.</p>
	</div>
	<TextInput
		type="number"
		size="sm"
		min={bounds.min}
		max={bounds.max}
		step={1}
		bind:value={draft}
		ariaLabel={label}
		disabled={value === null}
		inputClass="w-16 text-right tabular-nums"
		onchange={onCommit}
	/>
</div>
