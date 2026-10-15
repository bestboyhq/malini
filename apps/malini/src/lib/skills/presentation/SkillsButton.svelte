<script lang="ts">
	import { onMount } from 'svelte';
	import type { SkillChoice } from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { goto } from '$shared/router/navigation';
	import { SKILL_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { resolveSkillChoice } from '$lib/skills/domain/skill-choice';
	import {
		formatTokens,
		groupSkills,
		matchesSkillFilter,
		skillShortName,
		skillTokens,
	} from '$lib/skills/domain/skill-groups';
	import { chooseSkillsCommand } from '$lib/skills/application/commands/choose-skills.command';
	import { ensureSkillCatalogCommand } from '$lib/skills/application/commands/ensure-skill-catalog.command';
	import { loadSkillCatalogCommand } from '$lib/skills/application/commands/load-skill-catalog.command';
	import { loadSkillChoiceCommand } from '$lib/skills/application/commands/load-skill-choice.command';
	import { loadSkillPresetsCommand } from '$lib/skills/application/commands/load-skill-presets.command';
	import { toggleChatSkillCommand } from '$lib/skills/application/commands/toggle-chat-skill.command';
	import { skillCatalogQuery } from '$lib/skills/application/queries/skill-catalog.query.svelte';
	import { skillChoiceQuery } from '$lib/skills/application/queries/skill-choice.query.svelte';
	import { skillPresetsQuery } from '$lib/skills/application/queries/skill-presets.query.svelte';

	interface Props {
		workstreamId: string;
		sessionId: string | null;
		disabled?: boolean;
	}

	let { workstreamId, sessionId, disabled = false }: Props = $props();
	let trigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let open = $state(false);
	let filter = $state('');

	const choice = $derived(skillChoiceQuery.data(workstreamId, sessionId));
	const presets = $derived(skillPresetsQuery.data);
	const catalog = $derived(skillCatalogQuery.data(workstreamId));
	const resolved = $derived(resolveSkillChoice(choice, presets));
	const active = $derived(
		resolved.skills === 'all'
			? new Set(catalog.skills.map(({ name }) => name))
			: new Set(resolved.skills),
	);
	const label = $derived(choiceLabel(choice));
	const emoji = $derived(choice.kind === 'custom' ? null : (resolved.preset?.emoji ?? null));
	const marked = $derived(presets.some((preset) => preset.emoji !== null));
	const count = $derived(
		resolved.skills === 'all' && catalog.state !== 'ready' ? null : active.size,
	);
	const tokens = $derived(skillTokens(catalog.skills, [...active]));
	const groups = $derived(
		groupSkills(catalog.skills.filter((skill) => matchesSkillFilter(skill, filter))),
	);
	const summary = $derived(
		count === null ? label : `${label} · ${count} ${count === 1 ? 'skill' : 'skills'}`,
	);

	onMount(() => {
		loadSkillChoiceCommand(workstreamId, sessionId);
		loadSkillPresetsCommand();
		ensureSkillCatalogCommand(workstreamId);
	});

	function choiceLabel(current: SkillChoice): string {
		if (current.kind === 'custom') return 'Custom';
		return resolved.preset?.name ?? 'All skills';
	}

	function toggleOpen(): void {
		if (disabled) return;
		open = !open;
		if (open) loadSkillCatalogCommand(workstreamId);
	}

	function choose(next: SkillChoice): void {
		chooseSkillsCommand(workstreamId, sessionId, next);
	}

	function editPresets(): void {
		open = false;
		void goto(SKILL_SETTINGS_HREF);
	}

	function presetChosen(presetId: string): boolean {
		return choice.kind !== 'custom' && choice.kind !== 'all' && resolved.preset?.id === presetId;
	}
</script>

<Tooltip
	content={`Skills this chat's agent can load · ${summary}`}
	placement="top"
	suppressed={open}
>
	<Button
		bind:element={trigger}
		variant="ghost"
		size="md"
		active={open}
		{disabled}
		class="text-fg-tertiary hover:bg-surface-50 gap-1.5 rounded-md text-xs font-normal"
		ariaLabel={`Skills: ${summary}`}
		ariaHasPopup="menu"
		ariaExpanded={open}
		data-testid="chat-skills"
		onclick={toggleOpen}
	>
		{#if emoji}
			<span class="grid size-[15px] place-items-center text-[13px] leading-none" aria-hidden="true">
				{emoji}
			</span>
		{:else}
			<Icon name="puzzle" size={15} />
		{/if}
		<span class="max-w-28 truncate @max-md/composer:hidden">{label}</span>
		{#if count !== null}
			<span class="tabular-nums">{count}</span>
		{/if}
	</Button>
</Tooltip>

<DropdownLayer
	{open}
	anchor={trigger}
	onclose={() => (open = false)}
	side="top"
	align="start"
	panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="chat-skills-menu"
	owner="chat-composer"
>
	<div role="menu" aria-label="Skills for this chat" class="flex max-h-[min(560px,70vh)] flex-col">
		<div class="flex items-baseline justify-between px-2.5 pt-1 pb-1.5">
			<p class="text-fg-default text-xs font-medium">Skills for this chat</p>
			<p class="text-fg-tertiary text-2xs tabular-nums">{formatTokens(tokens)}</p>
		</div>
		<div role="group" aria-label="Presets" class="shrink-0">
			<DropdownItem
				role="menuitemradio"
				aria-checked={choice.kind === 'all'}
				checked={choice.kind === 'all'}
				focusOnHover={false}
				closeOnSelect={false}
				class="justify-between gap-2"
				onclick={() => choose({ kind: 'all' })}
			>
				<span class="flex min-w-0 flex-col">
					<span>All skills</span>
					<span class="text-fg-tertiary text-xs">Everything Claude Code finds</span>
				</span>
				{#if choice.kind === 'all'}
					<Icon name="check" size={14} class="shrink-0" />
				{/if}
			</DropdownItem>
			{#each presets as preset (preset.id)}
				{@const chosen = presetChosen(preset.id)}
				<DropdownItem
					role="menuitemradio"
					aria-checked={chosen}
					checked={chosen}
					focusOnHover={false}
					closeOnSelect={false}
					class="justify-between gap-2"
					onclick={() => choose({ kind: 'preset', presetId: preset.id })}
				>
					<span class="flex min-w-0 items-center gap-1.5">
						{#if marked}
							<span class="w-4 shrink-0 text-center leading-none" aria-hidden="true">
								{preset.emoji ?? ''}
							</span>
						{/if}
						<span class="truncate">{preset.name}</span>
						{#if preset.isDefault}
							<span class="text-fg-tertiary text-2xs shrink-0">Default</span>
						{/if}
					</span>
					<span class="flex shrink-0 items-center gap-2">
						<span class="text-fg-tertiary text-2xs tabular-nums">{preset.skills.length}</span>
						{#if chosen}
							<Icon name="check" size={14} />
						{/if}
					</span>
				</DropdownItem>
			{/each}
		</div>

		<div class="border-surface-elevated-border mx-1 my-1.5 border-t" role="separator"></div>

		<div class="flex shrink-0 items-center gap-2 px-1 pb-1">
			<TextInput
				bind:value={filter}
				size="sm"
				placeholder="Filter skills"
				ariaLabel="Filter skills"
				class="flex-1"
			>
				{#snippet icon()}
					<Icon name="search" size={12} />
				{/snippet}
			</TextInput>
		</div>
		<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Skills">
			{#if catalog.skills.length === 0}
				<p class="text-fg-tertiary px-2.5 py-3 text-xs">
					{catalog.state === 'error'
						? `Could not list skills. ${catalog.error ?? ''}`
						: 'Looking for skills…'}
				</p>
			{/if}
			{#each groups as group (group.key)}
				<div role="group" aria-label={group.label}>
					<p class="text-2xs text-fg-tertiary px-2.5 pt-1.5 pb-0.5 font-medium">{group.label}</p>
					{#each group.skills as skill (skill.name)}
						{@const on = active.has(skill.name)}
						<DropdownItem
							role="menuitemcheckbox"
							aria-checked={on}
							checked={on}
							focusOnHover={false}
							closeOnSelect={false}
							class="justify-between gap-2"
							onclick={() => toggleChatSkillCommand(workstreamId, sessionId, skill.name)}
						>
							<span class={['min-w-0 truncate', !on && 'text-fg-tertiary']}>
								{skillShortName(skill.name)}
							</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="text-fg-tertiary text-3xs font-mono tabular-nums">{skill.tokens}</span>
								<span class="grid size-3.5 place-items-center">
									{#if on}
										<Icon name="check" size={14} />
									{/if}
								</span>
							</span>
						</DropdownItem>
					{/each}
				</div>
			{/each}
		</ScrollableDiv>

		<div class="border-surface-elevated-border mx-1 my-1.5 border-t" role="separator"></div>
		<DropdownItem role="menuitem" focusOnHover={false} class="gap-2" onclick={editPresets}>
			<Icon name="settings" size={14} class="shrink-0" />
			Edit presets…
		</DropdownItem>
	</div>
</DropdownLayer>
