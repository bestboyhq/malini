<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { closeSoundRecorderCommand } from '$shared/sounds/application/commands/close-sound-recorder.command';
	import { finishSoundRecordingCommand } from '$shared/sounds/application/commands/finish-sound-recording.command';
	import { openMicrophoneSettingsCommand } from '$shared/sounds/application/commands/open-microphone-settings.command';
	import { startSoundRecordingCommand } from '$shared/sounds/application/commands/start-sound-recording.command';
	import type { SoundRecorderState } from '$shared/sounds/domain/sounds';

	interface Props {
		recorder: SoundRecorderState;
	}

	let { recorder }: Props = $props();

	const recording = $derived(recorder.phase === 'recording');
	const seconds = $derived(`0:0${(recorder.elapsedMs / 1000).toFixed(1)}`);

	function onRecord(): void {
		if (recording) finishSoundRecordingCommand();
		else startSoundRecordingCommand();
	}
</script>

<div class="pr-4 pb-4 pl-14">
	<div
		class="bg-surface-root border-border-default flex h-12 items-center gap-3 rounded-xl border-[0.5px] px-2"
	>
		{#if recorder.phase !== 'denied'}
			<Tooltip content={recording ? 'Stop' : 'Record'} placement="top">
				<IconButton
					ariaLabel={recording ? 'Stop recording' : 'Start recording'}
					variant="secondary"
					size="md"
					radius="full"
					disabled={recorder.phase === 'asking'}
					ariaPressed={recording}
					onclick={onRecord}
				>
					{#if recording}
						<Icon name="stop" size={14} />
					{:else if recorder.phase === 'asking'}
						<BusyIcon size={14} class="text-fg-secondary" />
					{:else}
						<Icon name="circle-dot" size={14} class="text-error-content" />
					{/if}
				</IconButton>
			</Tooltip>
		{/if}
		{#if recorder.phase === 'asking'}
			<span class="text-fg-tertiary min-w-0 flex-1 text-xs leading-5">
				Allow the microphone to record.
			</span>
		{:else if recorder.phase === 'denied'}
			<span class="text-fg-secondary min-w-0 flex-1 pl-2 text-xs leading-5">
				Malini can’t use your microphone.
			</span>
			<Button variant="secondary" size="sm" bordered onclick={openMicrophoneSettingsCommand}>
				Open System Settings
			</Button>
		{:else if recording}
			<span class="text-fg-default w-10 shrink-0 text-sm tabular-nums">{seconds}</span>
			<span class="flex h-6 min-w-0 flex-1 items-center gap-0.5" aria-hidden="true">
				{#each recorder.levels as level, index (index)}
					<span
						class="text-fg-secondary w-0.5 shrink-0 rounded-full bg-current"
						style:height={`${Math.max(8, level * 100)}%`}
					></span>
				{/each}
			</span>
		{:else}
			<span class="text-fg-tertiary min-w-0 flex-1 text-xs leading-5">
				Up to 3 seconds. It joins both lists.
			</span>
		{/if}
		<Tooltip content="Cancel" placement="top">
			<IconButton
				ariaLabel="Cancel recording"
				variant="ghost"
				size="md"
				radius="full"
				onclick={closeSoundRecorderCommand}
			>
				<Icon name="close" size={13} />
			</IconButton>
		</Tooltip>
	</div>
</div>
