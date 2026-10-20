<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Switch } from '$hyper-ui/components/switch';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { formatTokens } from '$lib/skills/domain/skill-groups';
	import {
		lastUsedLabel,
		matchesUsageFilter,
		skillUsageOrigin,
		skillUsageSummary,
		skillUsesLabel,
		type SkillHeat,
	} from '$lib/skills/domain/skill-usage';
	import { loadSkillCatalogCommand } from '$lib/skills/application/commands/load-skill-catalog.command';
	import { loadSkillUsageCommand } from '$lib/skills/application/commands/load-skill-usage.command';
	import { switchSkillCommand } from '$lib/skills/application/commands/switch-skill.command';
	import { skillCatalogQuery } from '$lib/skills/application/queries/skill-catalog.query.svelte';
	import { skillUsageRowsQuery } from '$lib/skills/application/queries/skill-usage-rows.query.svelte';
	import { skillUsageQuery } from '$lib/skills/application/queries/skill-usage.query.svelte';

	const now = Date.now();
	const sinceFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

	let filter = $state('');

	const catalog = $derived(skillCatalogQuery.data(null));
	const usage = $derived(skillUsageQuery.data);
	const rows = $derived(skillUsageRowsQuery.data);
	const shown = $derived(rows.filter((row) => matchesUsageFilter(row, filter)));
	const summary = $derived(skillUsageSummary(rows));
	const failure = $derived(
		usage.state === 'error' ? usage.error : catalog.state === 'error' ? catalog.error : null,
	);
	const loading = $derived(rows.length === 0 && failure === null && catalog.state !== 'ready');
	const since = $derived(
		usage.report?.since ? sinceFormat.format(new Date(usage.report.since)) : null,
	);
	const listId = $props.id();

	onMount(() => {
		loadSkillCatalogCommand(null);
		loadSkillUsageCommand();
	});

	function retry(): void {
		loadSkillCatalogCommand(null);
		loadSkillUsageCommand();
	}

	function heatClass(heat: SkillHeat): string {
		if (heat === 4) return 'bg-activity-4';
		if (heat === 3) return 'bg-activity-3';
		if (heat === 2) return 'bg-activity-2';
		if (heat === 1) return 'bg-activity-1';
		return 'bg-surface-50-selected';
	}
</script>

<section
	class="bg-surface-root flex min-w-0 flex-col gap-1.5 rounded-[18px] p-1.5"
	aria-label="Your skills"
>
	<header class="flex h-8 items-center gap-2 pr-0.5 pl-3">
		<h3 class="text-fg-default text-xs font-medium">Your skills</h3>
		{#if rows.length > 0}
			<span
				class="text-fg-tertiary text-3xs font-mono tabular-nums"
				data-testid="skill-usage-totals"
			>
				{summary.on} on · {formatTokens(summary.tokens)} in every chat
			</span>
		{/if}
		<TextInput
			bind:value={filter}
			size="sm"
			placeholder="Filter"
			ariaLabel="Filter skills"
			class="ml-auto w-36"
		>
			{#snippet icon()}
				<Icon name="search" size={12} />
			{/snippet}
		</TextInput>
	</header>

	{#if failure !== null && rows.length === 0}
		<StateBlock
			heading="Could not read your skills"
			detail={failure}
			remedy="Malini asks Claude Code which skills it has and reads how often it used them."
			tone="critical"
			testId="skill-usage-error"
		>
			{#snippet action()}
				<Button variant="secondary" size="sm" onclick={retry}>Try again</Button>
			{/snippet}
		</StateBlock>
	{:else if loading}
		<div class="flex flex-col gap-1 px-1.5 pb-1.5" aria-label="Loading skills">
			{#each [0, 1, 2, 3, 4, 5] as row (row)}
				<Skeleton height="52px" class="rounded-xl" />
			{/each}
		</div>
	{:else}
		{#if summary.unused > 0 && filter.trim() === ''}
			<p class="text-fg-secondary px-3 pb-1 text-xs" data-testid="skill-usage-unused">
				{summary.unused} of the skills you keep on {summary.unused === 1 ? 'was' : 'were'} never used.
				They cost {formatTokens(summary.unusedTokens)} in every chat.
			</p>
		{/if}
		{#if shown.length === 0}
			<p class="text-fg-tertiary px-3 py-6 text-center text-xs">
				{filter ? `No skill matches “${filter}”.` : 'Claude Code found no skills.'}
			</p>
		{:else}
			<ul
				class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
				aria-label="Skills by use"
			>
				{#each shown as row (row.key)}
					{@const labelId = `${listId}-${row.key}`}
					<li
						class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5 pr-3 pl-3.5"
						aria-labelledby={labelId}
					>
						<span class={['size-3 rounded-[3px]', heatClass(row.heat)]} aria-hidden="true"></span>
						<div class="min-w-0">
							<div class="flex min-w-0 items-baseline gap-2">
								<h4
									id={labelId}
									class={[
										'truncate text-sm font-medium',
										row.on ? 'text-fg-default' : 'text-fg-tertiary',
									]}
								>
									{row.name}
								</h4>
								<span class="text-fg-tertiary text-2xs shrink-0">{skillUsageOrigin(row)}</span>
							</div>
							{#if row.description}
								<p class="text-fg-tertiary truncate text-xs">{row.description}</p>
							{/if}
						</div>
						<div class="flex flex-col items-end text-right tabular-nums">
							<span class={['text-xs', row.uses > 0 ? 'text-fg-secondary' : 'text-fg-tertiary']}>
								{skillUsesLabel(row.uses)}
							</span>
							<span class="text-fg-tertiary text-2xs whitespace-nowrap">
								{lastUsedLabel(row.lastUsedAt, now)} · {formatTokens(row.tokens)}
							</span>
						</div>
						<Switch
							checked={row.on}
							disabled={row.switchName === null}
							ariaLabel={`${row.kind === 'plugin' ? 'Plugin' : 'Skill'} ${row.name}`}
							onchange={(on) => switchSkillCommand(row, on)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
		{#if since}
			<p class="text-fg-tertiary text-2xs px-3 pt-0.5 pb-1">
				Uses come from Claude Code and count every session, here and in the terminal, since {since}.
			</p>
		{/if}
	{/if}
</section>
