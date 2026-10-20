<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import {
		SKILL_PRESET_NAME_MAX_LENGTH,
		type SkillPresetRecord,
		type SkillRecord,
	} from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { formatTokens, skillShortName, skillTokens } from '$lib/skills/domain/skill-groups';
	import SkillPresetEmojiPicker from './SkillPresetEmojiPicker.svelte';

	interface Props {
		preset: SkillPresetRecord;
		skills: readonly SkillRecord[];
		dragging: string | null;
		over: boolean;
		renaming: boolean;
		onremove: (skill: string) => void;
		onrename: (name: string) => void;
		onstartrename: () => void;
		onemoji: (emoji: string | null) => void;
		ondelete: () => void;
	}

	let {
		preset,
		skills,
		dragging,
		over,
		renaming,
		onremove,
		onrename,
		onstartrename,
		onemoji,
		ondelete,
	}: Props = $props();
	let menuTrigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let menuOpen = $state(false);
	let deleteArmed = $state(false);
	let nameInput: HTMLInputElement | null = $state(null);

	const skillTokensByName = $derived(new Map(skills.map(({ name, tokens }) => [name, tokens])));
	const tokens = $derived(skillTokens(skills, preset.skills));
	const alreadyHere = $derived(dragging !== null && preset.skills.includes(dragging));
	const headingId = $props.id();

	$effect(() => {
		if (!nameInput) return;
		nameInput.focus();
		nameInput.select();
	});

	function onNameKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
			event.preventDefault();
			onrename(event.currentTarget.value);
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onrename(preset.name);
		}
	}

	function onNameBlur(event: FocusEvent): void {
		if (event.currentTarget instanceof HTMLInputElement) onrename(event.currentTarget.value);
	}

	function closeMenu(): void {
		menuOpen = false;
		deleteArmed = false;
	}

	function closeMenuThen(action: () => void): void {
		closeMenu();
		action();
	}

	function onDeleteClick(event: MouseEvent): void {
		if (deleteArmed) {
			closeMenu();
			ondelete();
			return;
		}
		event.preventDefault();
		deleteArmed = true;
	}
</script>

<section
	class={[
		'bg-surface-100 relative flex flex-col gap-2.5 rounded-xl border-[0.5px] px-3 pt-2.5 pb-3',
		'transition-[border-color,box-shadow,scale] duration-150 ease-out motion-reduce:transition-none',
		over && !alreadyHere
			? 'border-primary scale-[1.01] shadow-lg'
			: 'border-surface-100-border shadow-xs',
	]}
	aria-labelledby={headingId}
	data-skill-drop={preset.id}
	data-testid="skill-preset"
	data-preset={preset.name}
>
	<header class="flex h-7 items-center gap-2">
		<SkillPresetEmojiPicker {preset} onpick={onemoji} />
		{#if renaming}
			<TextInput
				bind:element={nameInput}
				value={preset.name}
				size="sm"
				maxlength={SKILL_PRESET_NAME_MAX_LENGTH}
				ariaLabel="Preset name"
				class="min-w-0 flex-1"
				onkeydown={onNameKeydown}
				onblur={onNameBlur}
			/>
		{:else}
			<h4 id={headingId} class="min-w-0 truncate">
				<Button
					bare
					class="text-fg-default hover:text-fg-default cursor-text truncate text-sm font-medium"
					ariaLabel={`Rename ${preset.name}`}
					ondblclick={onstartrename}
				>
					{preset.name}
				</Button>
			</h4>
		{/if}
		<span class="text-fg-tertiary text-2xs ml-auto shrink-0 tabular-nums">
			{formatTokens(tokens)}
		</span>
		<IconButton
			bind:element={menuTrigger}
			variant="ghost"
			size="sm"
			ariaLabel={`${preset.name} options`}
			ariaHasPopup="menu"
			ariaExpanded={menuOpen}
			active={menuOpen}
			class="text-fg-tertiary -mr-1"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<Icon name="more" size={14} />
		</IconButton>
	</header>

	<ul class="flex min-h-7 flex-wrap gap-1" aria-label={`Skills in ${preset.name}`}>
		{#each preset.skills as skill (skill)}
			<li
				class={[
					'bg-chip border-chip-border flex h-7 items-center gap-1 rounded-lg border-[0.5px] pr-0.5 pl-2',
					!skillTokensByName.has(skill) && 'opacity-50',
				]}
				animate:flip={{ duration: 180, easing: cubicOut }}
				in:scale={{ start: 0.85, duration: 180, easing: cubicOut }}
				data-testid="skill-preset-skill"
			>
				<span class="text-fg-default max-w-40 truncate text-xs">{skillShortName(skill)}</span>
				{#if skillTokensByName.has(skill)}
					<span class="text-fg-tertiary text-3xs font-mono tabular-nums">
						{skillTokensByName.get(skill)}
					</span>
				{/if}
				<IconButton
					variant="ghost"
					size="xs"
					ariaLabel={`Remove ${skill} from ${preset.name}`}
					class="text-fg-tertiary"
					onclick={() => onremove(skill)}
				>
					<Icon name="close" size={12} />
				</IconButton>
			</li>
		{/each}
		{#if over}
			<li
				class="border-border-default text-fg-secondary flex h-7 items-center gap-1 rounded-lg border-[0.5px] border-dashed px-2 text-xs"
				in:scale={{ start: 0.9, duration: 140, easing: cubicOut }}
				aria-hidden="true"
			>
				{#if alreadyHere}
					Already in {preset.name}
				{:else}
					<Icon name="plus" size={12} />
					{dragging ? skillShortName(dragging) : ''}
				{/if}
			</li>
		{:else if preset.skills.length === 0}
			<li
				class="border-border-default text-fg-tertiary flex h-7 flex-1 items-center justify-center rounded-lg border-[0.5px] border-dashed text-xs"
			>
				Drag skills here
			</li>
		{/if}
	</ul>
</section>

<DropdownLayer
	role={null}
	open={menuOpen}
	anchor={menuTrigger}
	onclose={closeMenu}
	side="bottom"
	align="end"
	panelClass="w-48 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="skill-preset-menu"
	owner="skill-preset-board"
>
	<div role="menu" aria-label={`${preset.name} options`}>
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2"
			onclick={() => closeMenuThen(onstartrename)}
		>
			<Icon name="pencil" size={14} class="shrink-0" />
			Rename
		</DropdownItem>
		<DropdownItem
			role="menuitem"
			variant="danger"
			focusOnHover={false}
			closeOnSelect={deleteArmed}
			class="gap-2"
			onclick={onDeleteClick}
		>
			<Icon name="trash" size={14} class="shrink-0" />
			{deleteArmed ? `Delete ${preset.name}?` : 'Delete'}
		</DropdownItem>
	</div>
</DropdownLayer>
