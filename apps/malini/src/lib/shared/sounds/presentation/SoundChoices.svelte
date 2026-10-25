<script lang="ts">
	import { onMount } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { addSoundFileCommand } from '$shared/sounds/application/commands/add-sound-file.command';
	import { chooseSoundCommand } from '$shared/sounds/application/commands/choose-sound.command';
	import { loadSoundsCommand } from '$shared/sounds/application/commands/load-sounds.command';
	import { openSoundRecorderCommand } from '$shared/sounds/application/commands/open-sound-recorder.command';
	import { playSoundCommand } from '$shared/sounds/application/commands/play-sound.command';
	import { soundChoicesQuery } from '$shared/sounds/application/queries/sound-choices.query.svelte';
	import { soundOptionsQuery } from '$shared/sounds/application/queries/sound-options.query.svelte';
	import { soundRecorderQuery } from '$shared/sounds/application/queries/sound-recorder.query.svelte';
	import {
		DEFAULT_SOUND_CHOICES,
		NO_SOUND,
		type SoundOption,
		type SoundSignal,
	} from '$shared/sounds/domain/sounds';
	import SoundRecorder from './SoundRecorder.svelte';

	interface Props {
		class?: ClassValue;
	}

	let { class: className }: Props = $props();

	const SIGNALS: readonly { signal: SoundSignal; icon: IconName; title: string; detail: string }[] =
		[
			{ signal: 'finished', icon: 'check', title: 'Finished', detail: 'A run is done' },
			{
				signal: 'needs-you',
				icon: 'question',
				title: 'Needs you',
				detail: 'A question, an approval or a failed run',
			},
		];
	const NO_SOUND_OPTION: SoundOption = { id: NO_SOUND, label: 'No sound', custom: false };
	const MENU_LIST_HEIGHT = 'max-h-[244px]';

	const choices = $derived(soundChoicesQuery.data);
	const options = $derived(soundOptionsQuery.data);
	const recorder = $derived(soundRecorderQuery.data);
	const builtIn = $derived(options.filter((option) => !option.custom));
	const yours = $derived(options.filter((option) => option.custom));

	let open = $state<Record<SoundSignal, boolean>>({ finished: false, 'needs-you': false });
	let lists = $state<Record<SoundSignal, HTMLDivElement | null>>({
		finished: null,
		'needs-you': null,
	});

	onMount(loadSoundsCommand);

	$effect(() => {
		for (const list of Object.values(lists)) {
			const item = list?.querySelector('[aria-checked="true"]');
			if (!list || !item) continue;
			const offset = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
			list.scrollTop += offset - (list.clientHeight - item.clientHeight) / 2;
		}
	});

	function optionFor(id: string, signal: SoundSignal): SoundOption {
		const all = [...options, NO_SOUND_OPTION];
		return (
			all.find((option) => option.id === id) ??
			all.find((option) => option.id === DEFAULT_SOUND_CHOICES[signal]) ??
			NO_SOUND_OPTION
		);
	}

	function onRecord(signal: SoundSignal): void {
		open[signal] = false;
		openSoundRecorderCommand(signal);
	}

	function onChooseFile(signal: SoundSignal): void {
		open[signal] = false;
		addSoundFileCommand(signal);
	}
</script>

<ol
	class={[
		'border-surface-50-border divide-surface-50-border divide-y-[0.5px] border-[0.5px]',
		className,
	]}
	aria-label="Sounds"
>
	{#each SIGNALS as row (row.signal)}
		{@const current = optionFor(choices[row.signal], row.signal)}
		<li>
			<div class="flex min-h-15 items-center gap-3 px-4">
				<span
					class="border-surface-50-border text-fg-secondary grid size-7 shrink-0 place-items-center rounded-full border-[0.5px]"
					aria-hidden="true"
				>
					<Icon name={row.icon} size={14} />
				</span>
				<span class="flex min-w-0 flex-col">
					<span class="text-fg-default text-[15px] font-medium">{row.title}</span>
					<span class="text-fg-tertiary text-xs leading-5">{row.detail}</span>
				</span>
				<span class="ml-auto flex items-center gap-1.5">
					<Tooltip content={`Play ${current.label}`} placement="top">
						<IconButton
							ariaLabel={`Play the ${row.title.toLowerCase()} sound`}
							variant="ghost"
							size="md"
							radius="full"
							disabled={current.id === NO_SOUND}
							onclick={() => playSoundCommand(current.id)}
						>
							<Icon name="play" size={14} />
						</IconButton>
					</Tooltip>
					<Dropdown
						bind:open={open[row.signal]}
						side="bottom"
						align="end"
						sideOffset={4}
						role={null}
						panelClass="w-56"
						contentClass="p-1.5"
					>
						{#snippet trigger()}
							<Button
								variant="secondary"
								bordered
								class="w-40"
								ariaLabel={`${row.title} sound: ${current.label}`}
								ariaHasPopup="menu"
								ariaExpanded={open[row.signal]}
							>
								<span class="min-w-0 flex-1 truncate text-left">{current.label}</span>
								{#snippet trailing()}
									<Icon name="chevron-down" size={13} class="text-fg-tertiary" />
								{/snippet}
							</Button>
						{/snippet}
						{#snippet content()}
							<div
								role="menu"
								aria-label={`${row.title} sound`}
								style:--scrollable-fade-color="var(--color-surface-elevated)"
							>
								<ScrollableDiv
									class={`-mx-1.5 -mt-1.5 ${MENU_LIST_HEIGHT}`}
									viewportClass={MENU_LIST_HEIGHT}
									contentClass="px-1.5 pt-1.5"
									fadeEdges
									bind:viewportRef={lists[row.signal]}
								>
									{#each builtIn as option (option.id)}
										{@render soundItem(row.signal, option)}
									{/each}
								</ScrollableDiv>
								{#if yours.length > 0}
									{@render separator()}
									{#each yours as option (option.id)}
										{@render soundItem(row.signal, option)}
									{/each}
								{/if}
								{@render separator()}
								{@render soundItem(row.signal, NO_SOUND_OPTION)}
								{@render separator()}
								<DropdownItem role="menuitem" class="gap-2.5" onSelect={() => onRecord(row.signal)}>
									<Icon name="circle-dot" size={14} class="text-error-content shrink-0" />
									<span class="min-w-0 flex-1 truncate text-left">Record a sound…</span>
								</DropdownItem>
								<DropdownItem
									role="menuitem"
									class="gap-2.5"
									onSelect={() => onChooseFile(row.signal)}
								>
									<Icon name="folder-open" size={14} class="shrink-0" />
									<span class="min-w-0 flex-1 truncate text-left">Choose a file…</span>
								</DropdownItem>
							</div>
						{/snippet}
					</Dropdown>
				</span>
			</div>
			{#if recorder?.signal === row.signal}
				<SoundRecorder {recorder} />
			{/if}
		</li>
	{/each}
</ol>

{#snippet soundItem(signal: SoundSignal, option: SoundOption)}
	<DropdownItem
		role="menuitemradio"
		aria-checked={choices[signal] === option.id}
		selected={choices[signal] === option.id}
		closeOnSelect={false}
		class="gap-2.5"
		onSelect={() => chooseSoundCommand(signal, option.id)}
	>
		<span class="min-w-0 flex-1 truncate text-left">{option.label}</span>
		{#if choices[signal] === option.id}
			<Icon name="check" size={13} class="text-fg-secondary shrink-0" />
		{/if}
	</DropdownItem>
{/snippet}

{#snippet separator()}
	<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
{/snippet}
