<script lang="ts">
	import type { SkillPresetRecord, SkillRecord } from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';
	import { skillPlugin, skillShortName } from '$lib/skills/domain/skill-groups';

	interface Props {
		skill: SkillRecord;
		presets: readonly SkillPresetRecord[];
		lifted?: boolean;
		onpress: (event: PointerEvent, row: HTMLElement) => void;
		consumeClick: () => boolean;
		ontoggle: (preset: SkillPresetRecord) => void;
		oncreate: () => void;
	}

	let {
		skill,
		presets,
		lifted = false,
		onpress,
		consumeClick,
		ontoggle,
		oncreate,
	}: Props = $props();
	let row: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let menuOpen = $state(false);

	const plugin = $derived(
		skillPlugin(skill.name) === skillShortName(skill.name) ? null : skillPlugin(skill.name),
	);
	const memberOf = $derived(presets.filter((preset) => preset.skills.includes(skill.name)));

	function onPointerDown(event: PointerEvent): void {
		if (row instanceof HTMLElement) onpress(event, row);
	}

	function onCreate(): void {
		menuOpen = false;
		oncreate();
	}

	function onRowClick(): void {
		if (consumeClick()) return;
		menuOpen = !menuOpen;
	}
</script>

<Button
	bind:element={row}
	bare
	class={[
		'group/skill hover:bg-surface-root-hover flex w-full cursor-grab touch-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-left select-none active:cursor-grabbing',
		'focus-visible:ring-border-default outline-0 focus-visible:ring-2',
		'transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
		lifted && 'scale-[0.98] opacity-35',
		menuOpen && 'bg-surface-root-selected',
	]}
	ariaLabel={`${skill.name}. Add to a preset`}
	ariaHasPopup="menu"
	ariaExpanded={menuOpen}
	data-testid="skill-row"
	data-skill={skill.name}
	onpointerdown={onPointerDown}
	onclick={onRowClick}
>
	<Icon
		name="grip"
		size={14}
		class="text-fg-tertiary group-hover/skill:text-fg-secondary shrink-0 transition-[color]"
	/>
	<span class="flex min-w-0 flex-1 flex-col">
		<span class="flex min-w-0 items-center gap-1.5">
			<span class="text-fg-default truncate text-xs font-medium">{skillShortName(skill.name)}</span>
			{#if plugin}
				<span class="text-fg-tertiary text-3xs shrink-0 font-mono">{plugin}</span>
			{/if}
		</span>
		{#if skill.description}
			<span class="text-fg-tertiary truncate text-xs leading-5">{skill.description}</span>
		{/if}
	</span>
	{#if memberOf.length > 0}
		<span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
			{#each memberOf.slice(0, 3) as preset (preset.id)}
				<span
					class="bg-chip border-chip-border text-fg-secondary text-3xs grid size-4 place-items-center rounded-[5px] border-[0.5px] font-medium uppercase"
				>
					{preset.name.slice(0, 1)}
				</span>
			{/each}
		</span>
	{/if}
	<span class="text-fg-tertiary text-3xs w-9 shrink-0 text-right font-mono tabular-nums">
		{skill.tokens}
	</span>
</Button>

<DropdownLayer
	open={menuOpen}
	anchor={row}
	onclose={() => (menuOpen = false)}
	side="bottom"
	align="end"
	panelClass="w-56 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="skill-row-menu"
	owner="skill-preset-board"
>
	<div role="menu" aria-label={`Presets with ${skill.name}`}>
		<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">Add to preset</p>
		{#each presets as preset (preset.id)}
			{@const included = preset.skills.includes(skill.name)}
			<DropdownItem
				role="menuitemcheckbox"
				aria-checked={included}
				checked={included}
				focusOnHover={false}
				closeOnSelect={false}
				class="justify-between gap-2"
				onclick={() => ontoggle(preset)}
			>
				<span class="truncate">{preset.name}</span>
				{#if included}
					<Icon name="check" size={14} class="shrink-0" />
				{/if}
			</DropdownItem>
		{/each}
		<DropdownItem role="menuitem" focusOnHover={false} class="gap-2" onclick={onCreate}>
			<Icon name="plus" size={14} class="shrink-0" />
			New preset with this skill
		</DropdownItem>
	</div>
</DropdownLayer>
