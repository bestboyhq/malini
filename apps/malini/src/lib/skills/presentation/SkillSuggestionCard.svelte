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
	const headingId = $props.id();
</script>

<section
	class={[
		'flex flex-col gap-2 rounded-xl border-[0.5px] border-dashed px-3 pt-2.5 pb-3',
		'transition-[border-color,scale] duration-150 ease-out motion-reduce:transition-none',
		blank && 'h-[88px] justify-center',
		over ? 'border-primary bg-surface-root-selected scale-[1.01]' : 'border-border-default',
	]}
	aria-labelledby={headingId}
	data-skill-drop={dropTarget}
	data-testid="skill-preset-suggestion"
	data-preset={suggestion.name}
>
	<header class="flex min-h-7 items-center gap-2">
		<h4 id={headingId} class="text-fg-secondary min-w-0 truncate text-sm font-medium">
			{suggestion.name}
		</h4>
		{#if !blank}
			<span class="text-fg-tertiary text-2xs ml-auto shrink-0 tabular-nums">
				{suggestion.skills.length} skills · {formatTokens(tokens)}
			</span>
			<Button
				variant="secondary"
				size="sm"
				radius="full"
				ariaLabel={`Add the ${suggestion.name} preset`}
				onclick={onadd}
			>
				{#snippet leading()}
					<Icon name="plus" size={12} />
				{/snippet}
				Add
			</Button>
		{/if}
	</header>
	{#if blank}
		<p class="text-fg-tertiary text-xs">Drop a skill here to start this preset.</p>
	{:else}
		<ul class="flex flex-wrap gap-1" aria-label={`Skills suggested for ${suggestion.name}`}>
			{#each suggestion.skills as skill (skill)}
				<li
					class="border-border-default text-fg-tertiary flex h-6 items-center rounded-md border-[0.5px] px-2 text-xs"
				>
					<span class="max-w-40 truncate">{skillShortName(skill)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
