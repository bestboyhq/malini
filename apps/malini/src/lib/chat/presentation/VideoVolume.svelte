<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { VolumeSlider } from '$hyper-ui/components/volume-slider';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		muted: boolean;
		volume: number;
		onchange: (sound: Readonly<{ muted: boolean; volume: number }>) => void;
	}

	let { muted, volume, onchange }: Props = $props();

	const level = $derived(muted ? 0 : volume);

	function onInput(next: number): void {
		onchange({ muted: next === 0, volume: next });
	}

	function toggleMute(): void {
		onchange({ muted: !muted, volume: muted && volume === 0 ? 1 : volume });
	}
</script>

<div class="group/volume relative flex">
	<Button
		variant="ghost"
		size="auto"
		ariaLabel={muted ? 'Unmute' : 'Mute'}
		class="text-fg-tertiary hover:text-fg-secondary h-7 w-7 justify-center rounded-md px-0"
		onclick={toggleMute}
	>
		<Icon name={level === 0 ? 'volume-off' : 'volume'} size={14} />
	</Button>
	<div
		class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 pb-1.5 opacity-0 transition-opacity duration-150 group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-has-[:focus-visible]/volume:pointer-events-auto group-has-[:focus-visible]/volume:opacity-100"
	>
		<div
			class="border-surface-elevated-border bg-surface-elevated h-24 rounded-lg border-[0.5px] shadow-sm"
		>
			<VolumeSlider value={level} label="Volume" oninput={onInput} />
		</div>
	</div>
</div>
