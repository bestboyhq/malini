<script lang="ts">
	import type { SkillPresetRecord } from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import {
		PRESET_EMOJI_CHOICES,
		firstEmoji,
		presetMark,
	} from '$lib/skills/domain/skill-preset-emoji';

	interface Props {
		preset: Pick<SkillPresetRecord, 'name' | 'emoji'>;
		onpick: (emoji: string | null) => void;
	}

	let { preset, onpick }: Props = $props();
	let trigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let open = $state(false);
	let typed = $state('');

	function pick(emoji: string | null): void {
		open = false;
		typed = '';
		if (emoji !== preset.emoji) onpick(emoji);
	}

	function onTyped(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const emoji = firstEmoji(event.currentTarget.value);
		if (emoji !== null) pick(emoji);
	}
</script>

<Tooltip content="Pick an emoji" placement="top" suppressed={open}>
	<Button
		bind:element={trigger}
		bare
		class={[
			'grid size-7 shrink-0 place-items-center rounded-lg border-[0.5px] select-none',
			'focus-visible:ring-border-default outline-0 focus-visible:ring-2',
			preset.emoji === null
				? 'border-chip-border bg-chip text-fg-tertiary hover:bg-chip-hover text-xs font-medium'
				: 'hover:bg-surface-100-hover border-transparent text-base leading-none',
			open && 'bg-surface-100-selected',
		]}
		ariaLabel={`Emoji for ${preset.name}`}
		ariaHasPopup="dialog"
		ariaExpanded={open}
		data-testid="skill-preset-emoji"
		onclick={() => (open = !open)}
	>
		{presetMark(preset)}
	</Button>
</Tooltip>

<DropdownLayer
	{open}
	anchor={trigger}
	onclose={() => (open = false)}
	side="bottom"
	align="start"
	panelClass="w-[17.5rem] rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	role={null}
	testId="skill-preset-emoji-picker"
	owner="skill-preset-board"
>
	<div role="dialog" aria-label={`Emoji for ${preset.name}`} class="flex flex-col gap-1.5">
		<div class="grid grid-cols-8 gap-0.5" role="group" aria-label="Emoji">
			{#each PRESET_EMOJI_CHOICES as emoji (emoji)}
				<Button
					bare
					class={[
						'grid aspect-square place-items-center rounded-md text-lg leading-none',
						'hover:bg-surface-elevated-hover focus-visible:bg-surface-elevated-hover outline-0',
						emoji === preset.emoji && 'bg-surface-elevated-selected',
					]}
					ariaLabel={emoji}
					ariaPressed={emoji === preset.emoji}
					onclick={() => pick(emoji)}
				>
					{emoji}
				</Button>
			{/each}
		</div>
		<div class="flex items-center gap-1.5">
			<TextInput
				bind:value={typed}
				size="sm"
				placeholder="Any emoji · ⌃⌘Space"
				ariaLabel="Type any emoji"
				class="min-w-0 flex-1"
				oninput={onTyped}
			/>
			{#if preset.emoji !== null}
				<Button variant="ghost" size="sm" class="text-fg-tertiary" onclick={() => pick(null)}>
					Remove
				</Button>
			{/if}
		</div>
	</div>
</DropdownLayer>
