<script lang="ts">
	import type { SkillPresetSuggestion, SkillRecord } from '$contract/skills';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { formatTokens, skillShortName, skillTokens } from '$lib/skills/domain/skill-groups';

	interface Props {
		suggestion: SkillPresetSuggestion;
		skills: readonly SkillRecord[];
		dropTarget: string;
		over: boolean;
		onadd: () => void;
	}

	let { suggestion, skills, dropTarget, over, onadd }: Props = $props();

	const blank = $derived(suggestion.skills.length === 0);
	const tokens = $derived(skillTokens(skills, suggestion.skills));
	const skillTokensByName = $derived(new Map(skills.map(({ name, tokens }) => [name, tokens])));
	const headingId = $props.id();
</script>

<section
	class={[
		'group/suggestion relative flex flex-col gap-2 rounded-xl border-[0.5px] border-dashed px-3 pt-2.5 pb-3',
		'transition-[border-color,scale] duration-150 ease-out motion-reduce:transition-none',
		blank && 'h-[88px] justify-center',
		!blank &&
			'hover:bg-surface-root-hover has-[:focus-visible]:ring-border-default has-[:focus-visible]:ring-2',
		over ? 'border-primary bg-surface-root-selected scale-[1.01]' : 'border-border-default',
	]}
	aria-labelledby={headingId}
	data-skill-drop={dropTarget}
	data-testid="skill-preset-suggestion"
	data-preset={suggestion.name}
>
	<header class="flex min-h-7 items-center gap-2">
		{#if suggestion.emoji}
			<span
				class="grid size-7 shrink-0 place-items-center text-base leading-none"
				aria-hidden="true"
			>
				{suggestion.emoji}
			</span>
		{/if}
		<h4 id={headingId} class="text-fg-secondary min-w-0 truncate text-sm font-medium">
			{suggestion.name}
		</h4>
		{#if !blank}
			<span class="text-fg-tertiary text-2xs ml-auto shrink-0 tabular-nums">
				{formatTokens(tokens)}
			</span>
			<span class="-mr-1 grid size-7 shrink-0 place-items-center" aria-hidden="true">
				<Icon
					name="plus"
					size={14}
					class="text-fg-secondary opacity-0 transition-opacity group-hover/suggestion:opacity-100 group-has-[:focus-visible]/suggestion:opacity-100"
				/>
			</span>
		{/if}
	</header>
	{#if blank}
		<p class="text-fg-tertiary text-xs">Drop a skill here to start this preset.</p>
	{:else}
		<ul class="flex flex-wrap gap-1" aria-label={`Skills suggested for ${suggestion.name}`}>
			{#each suggestion.skills as skill (skill)}
				<li
					class="border-border-default text-fg-tertiary flex h-6 items-center gap-1 rounded-md border-[0.5px] px-2 text-xs"
				>
					<span class="max-w-40 truncate">{skillShortName(skill)}</span>
					{#if skillTokensByName.has(skill)}
						<span class="text-3xs font-mono tabular-nums opacity-70">
							{skillTokensByName.get(skill)}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		<Button
			bare
			class="absolute inset-0 cursor-pointer rounded-xl outline-0"
			ariaLabel={`Add the ${suggestion.name} preset`}
			onclick={onadd}
		/>
	{/if}
</section>
