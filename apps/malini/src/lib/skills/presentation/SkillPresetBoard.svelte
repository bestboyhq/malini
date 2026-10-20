<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import type { ClassValue } from 'svelte/elements';
	import type { SkillPresetRecord } from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import {
		formatTokens,
		groupSkills,
		matchesSkillFilter,
		skillShortName,
		skillTokens,
	} from '$lib/skills/domain/skill-groups';
	import { addSkillToPresetCommand } from '$lib/skills/application/commands/add-skill-to-preset.command';
	import { createSkillPresetCommand } from '$lib/skills/application/commands/create-skill-preset.command';
	import { deleteSkillPresetCommand } from '$lib/skills/application/commands/delete-skill-preset.command';
	import { loadSkillCatalogCommand } from '$lib/skills/application/commands/load-skill-catalog.command';
	import { loadSkillUsageCommand } from '$lib/skills/application/commands/load-skill-usage.command';
	import { loadSkillPresetsCommand } from '$lib/skills/application/commands/load-skill-presets.command';
	import { removeSkillFromPresetCommand } from '$lib/skills/application/commands/remove-skill-from-preset.command';
	import { renameSkillPresetCommand } from '$lib/skills/application/commands/rename-skill-preset.command';
	import { setSkillPresetEmojiCommand } from '$lib/skills/application/commands/set-skill-preset-emoji.command';
	import { startRenamingSkillPresetCommand } from '$lib/skills/application/commands/start-renaming-skill-preset.command';
	import { renamingSkillPresetQuery } from '$lib/skills/application/queries/renaming-skill-preset.query.svelte';
	import { skillCatalogQuery } from '$lib/skills/application/queries/skill-catalog.query.svelte';
	import { skillsOnQuery } from '$lib/skills/application/queries/skills-on.query.svelte';
	import { skillPresetsQuery } from '$lib/skills/application/queries/skill-presets.query.svelte';
	import SkillPresetCard from './SkillPresetCard.svelte';
	import SkillRow from './SkillRow.svelte';
	import { SkillDrag } from './skill-drag.svelte';

	const NEW_PRESET = 'new';

	interface Props {
		workstreamId?: string | null;
		class?: ClassValue;
	}

	let { workstreamId = null, class: className }: Props = $props();
	let filter = $state('');

	const known = $derived(skillCatalogQuery.data(workstreamId));
	const catalog = $derived(skillsOnQuery.data(workstreamId));
	const presets = $derived(skillPresetsQuery.data);
	const renaming = $derived(renamingSkillPresetQuery.data);
	const groups = $derived(
		groupSkills(catalog.skills.filter((skill) => matchesSkillFilter(skill, filter))),
	);
	const totalTokens = $derived(skillTokens(catalog.skills, 'all'));
	const drag = new SkillDrag(onDrop);
	const lifted = $derived(catalog.skills.find(({ name }) => name === drag.skill) ?? null);
	const skillsHeadingId = $props.id();

	onMount(() => {
		loadSkillCatalogCommand(workstreamId);
		loadSkillUsageCommand();
		loadSkillPresetsCommand();
		return () => drag.dispose();
	});

	function onDrop(skill: string, target: string): void {
		if (target === NEW_PRESET) {
			createSkillPresetCommand({ name: nextPresetName(), skills: [skill] }, true);
			return;
		}
		addSkillToPresetCommand(target, skill);
	}

	function onToggle(preset: SkillPresetRecord, skill: string): void {
		if (preset.skills.includes(skill)) removeSkillFromPresetCommand(preset.id, skill);
		else addSkillToPresetCommand(preset.id, skill);
	}

	function nextPresetName(): string {
		const taken = new Set(presets.map(({ name }) => name));
		let index = presets.length + 1;
		while (taken.has(`Preset ${index}`)) index += 1;
		return `Preset ${index}`;
	}

	function portal(node: HTMLElement): { destroy(): void } {
		document.body.append(node);
		return { destroy: () => node.remove() };
	}
</script>

<div
	class={['grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2', className]}
	data-testid="skill-preset-board"
	data-dragging={drag.skill ?? undefined}
>
	<section
		class="bg-surface-root flex min-h-0 flex-col rounded-[18px]"
		aria-labelledby={skillsHeadingId}
	>
		<header class="flex h-11 shrink-0 items-center gap-2 pr-2 pl-3.5">
			<h3 id={skillsHeadingId} class="text-fg-default text-xs font-medium">Your skills</h3>
			{#if catalog.skills.length > 0}
				<span class="text-fg-tertiary text-2xs tabular-nums">
					{catalog.skills.length} · {formatTokens(totalTokens)}
				</span>
			{/if}
			<TextInput
				bind:value={filter}
				size="sm"
				placeholder="Filter"
				ariaLabel="Filter skills"
				class="ml-auto w-32"
			>
				{#snippet icon()}
					<Icon name="search" size={12} />
				{/snippet}
			</TextInput>
		</header>
		<ScrollableDiv
			class="min-h-0 flex-1"
			contentClass="px-1.5 pb-1.5"
			ariaLabel="Your skills"
			fadeEdges
		>
			{#if catalog.skills.length === 0 && catalog.state === 'error'}
				<StateBlock
					heading="Could not list your skills"
					detail={catalog.error}
					remedy="Malini asks Claude Code which skills it can load. Check that Claude Code is set up."
					tone="critical"
					testId="skill-catalog-error"
				>
					{#snippet action()}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => loadSkillCatalogCommand(workstreamId)}
						>
							Try again
						</Button>
					{/snippet}
				</StateBlock>
			{:else if catalog.skills.length === 0 && catalog.state !== 'ready'}
				<div class="flex flex-col gap-1 px-2.5 pt-1" aria-label="Loading skills">
					{#each [0, 1, 2, 3, 4, 5] as row (row)}
						<Skeleton height="36px" class="rounded-xl" />
					{/each}
				</div>
			{:else if groups.length === 0}
				<p class="text-fg-tertiary px-2.5 py-6 text-center text-xs">
					{filter ? `No skill matches “${filter}”.` : 'Claude Code found no skills.'}
				</p>
			{:else}
				{#each groups as group (group.key)}
					<div role="group" aria-label={group.label} class="mb-1.5 last:mb-0">
						<p class="text-fg-tertiary text-2xs px-2.5 pt-2 pb-1 font-medium">
							{group.label}
							<span class="tabular-nums">· {group.skills.length}</span>
						</p>
						<ul class="flex flex-col gap-1.5">
							{#each group.skills as skill (skill.name)}
								<li>
									<SkillRow
										{skill}
										{presets}
										lifted={drag.skill === skill.name}
										onpress={(event, row) => drag.press(event, skill.name, row)}
										consumeClick={() => drag.consumeClick()}
										ontoggle={(preset) => onToggle(preset, skill.name)}
										oncreate={() =>
											createSkillPresetCommand(
												{ name: nextPresetName(), skills: [skill.name] },
												true,
											)}
									/>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			{/if}
		</ScrollableDiv>
	</section>

	<section class="bg-surface-root flex min-h-0 flex-col rounded-[18px]" aria-label="Presets">
		<header class="flex h-11 shrink-0 items-center gap-2 pr-2 pl-3.5">
			<h3 class="text-fg-default text-xs font-medium">Presets</h3>
			<Button
				variant="ghost"
				size="sm"
				class="text-fg-secondary ml-auto"
				onclick={() => createSkillPresetCommand({ name: nextPresetName(), skills: [] }, true)}
			>
				{#snippet leading()}
					<Icon name="plus" size={14} />
				{/snippet}
				New preset
			</Button>
		</header>
		<ScrollableDiv
			class="min-h-0 flex-1"
			contentClass="flex flex-col gap-1.5 px-1.5 pb-1.5"
			ariaLabel="Presets"
			fadeEdges
		>
			{#each presets as preset (preset.id)}
				<div animate:flip={{ duration: 200, easing: cubicOut }}>
					<SkillPresetCard
						{preset}
						skills={known.skills}
						dragging={drag.skill}
						over={drag.target === preset.id}
						renaming={renaming === preset.id}
						onremove={(skill) => removeSkillFromPresetCommand(preset.id, skill)}
						onrename={(name) => renameSkillPresetCommand(preset.id, name)}
						onstartrename={() => startRenamingSkillPresetCommand(preset.id)}
						onemoji={(emoji) => setSkillPresetEmojiCommand(preset.id, emoji)}
						ondelete={() => deleteSkillPresetCommand(preset.id)}
					/>
				</div>
			{/each}
			<div
				class={[
					'flex h-14 shrink-0 items-center justify-center gap-1.5 rounded-xl border-[0.5px] border-dashed text-xs',
					'transition-[border-color,scale,opacity] duration-150 ease-out motion-reduce:transition-none',
					drag.target === NEW_PRESET
						? 'border-primary bg-surface-root-selected text-fg-secondary scale-[1.01]'
						: 'border-border-default text-fg-tertiary',
					drag.skill === null && presets.length > 0 && 'opacity-0',
				]}
				data-skill-drop={NEW_PRESET}
				aria-hidden="true"
			>
				<Icon name="plus" size={12} />
				Drop here for a new preset
			</div>
		</ScrollableDiv>
	</section>
</div>

{#if drag.skill && lifted}
	<div
		use:portal
		use:drag.ghost
		class="pointer-events-none fixed top-0 left-0 z-50"
		aria-hidden="true"
	>
		<div
			class={[
				'bg-surface-elevated border-surface-elevated-border flex max-w-72 min-w-44 items-center gap-2.5 rounded-xl border-[0.5px] px-2.5 py-2 shadow-xl',
				'skill-lift motion-reduce:animate-none',
			]}
		>
			<Icon name="grip" size={14} class="text-fg-tertiary shrink-0" />
			<span class="text-fg-default min-w-0 flex-1 truncate text-xs font-medium">
				{skillShortName(lifted.name)}
			</span>
			<span class="text-fg-tertiary text-3xs font-mono tabular-nums">{lifted.tokens}</span>
		</div>
	</div>
{/if}

<style>
	.skill-lift {
		animation: skill-lift 160ms cubic-bezier(0.2, 0, 0, 1) both;
	}

	@keyframes skill-lift {
		from {
			scale: 1;
			rotate: 0deg;
		}
		to {
			scale: 1.03;
			rotate: -1.5deg;
		}
	}
</style>
